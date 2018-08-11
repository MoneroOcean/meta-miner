#!/usr/bin/env node

// Meta Miner: adding algo switching support to *any* stratum miner
// Algo switching is supported by https://moneroocean.stream mining pool

// Copyright 2018 MoneroOcean <https://github.com/MoneroOcean>, <support@moneroocean.stream>

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <http://www.gnu.org/licenses/>.

"use strict";

// *** dependecies

const fs            = require('fs');
const net           = require('net');
const child_process = require('child_process');

// *** consts

const VERSION      = "v0.1";
const DEFAULT_ALGO = "cn/1";
const AGENT        = "Meta Miner " + VERSION;

const hashrate_regexes = [
  /\[[^\]]+\] speed 2.5s\/60s\/15m [\d\.]+ ([\d\.]+)/, // for old xmrig
  /\[[^\]]+\] speed 10s\/60s\/15m [\d\.]+ ([\d\.]+)/,  // for new xmrig
  /Totals \(ALL\):\s+([\d\.]+)/,                       // xmr-stak
];

// basic algo for each algo class that is used for performance measurements
const algo_perf_algo = {
  "cn":       "cn/1",
  "cn-fast":  "cn/msr",
  "cn-lite":  "cn-lite/1",
  "cn-heavy": "cn-heavy/0",
};

// *** config

let CONFIG_FILE = __dirname + "/mm.json";

let c = {
  miner_port: 3333,
  pools: [],
  algos: {},
  algo_perf: {
    "cn":       0,
    "cn-fast":  0,
    "cn-lite":  0,
    "cn-heavy": 0,
  },
  user: null,
  pass: null,
  log_file: null,
  is_quiet_mode: false,
  is_no_config_save: false,
  is_debug: false
};

// *** working state

let curr_miner_socket = null;
let curr_pool_socket  = null;
let curr_pool_job1    = null;
let curr_miner        = null;
let curr_pool_num     = 0;

let main_pool_check_timer = null;
let miner_proc            = null;
let miner_login_cb        = null;

// *** functions

function log(msg) {
  console.log(">>> " + msg);
  if (c.log_file) fs.appendFileSync(c.log_file, ">>> " + msg + "\n");
}

function err(msg) {
  console.error("!!! " + msg);
  if (c.log_file) fs.appendFileSync(c.log_file, "!!! " + msg + "\n");
}

function connect_pool(pool_num, pool_ok_cb, pool_new_msg_cb, pool_err_cb) {
  let pool_address_parts = c.pools[pool_num].split(/:/);

  let pool_socket = new net.Socket();

  pool_socket.connect(pool_address_parts[1], pool_address_parts[0], function () {
    pool_socket.write('{"id":1,"jsonrpc": "2.0","method":"login","params":{"login":"' + c.user + '","pass":"' + c.pass + '","agent":"' + AGENT + '","algo":' + JSON.stringify(Object.keys(c.algos)) + ',"algo-perf":' + JSON.stringify(c.algo_perf) + '}}\n');
  });

  let is_pool_ok = false; 
  let pool_data_buff = "";

  pool_socket.on('data', function (msg) {
    pool_data_buff += msg;
    if (pool_data_buff.indexOf('\n') === -1) return;
    let messages = pool_data_buff.split('\n');
    let incomplete_line = pool_data_buff.slice(-1) === '\n' ? '' : messages.pop();
    for (let i = 0; i < messages.length; i++) {
      let message = messages[i];
      if (message.trim() === '') continue;
      try {
        const json = JSON.parse(message);
        if (c.is_debug) log("Pool message: " + JSON.stringify(json));
        const is_new_job = ("result" in json && (json.result instanceof Object) && "job" in json.result && (json.result.job instanceof Object)) ||
                           ("method" in json && json.method === "job" && "params" in json && (json.params instanceof Object));
        if (is_new_job) {
          if (!is_pool_ok) { pool_ok_cb(pool_num, pool_socket); is_pool_ok = true; }
        }
        if (is_pool_ok) pool_new_msg_cb(is_new_job, json);
        else err("Ignoring pool message that does not contain job: " + JSON.stringify(json));
      } catch (e) {
        err("Can't parse message from the pool: " + message);
      }
    }
    pool_data_buff = incomplete_line;
    
  });

  pool_socket.on('error', function() {
    err("Pool " + c.pools[pool_num] + " socket error");
    pool_socket.destroy();
    pool_err_cb();
  });
}

let miner_server = net.createServer(function (miner_socket) {
  if (curr_miner_socket) {
    err("Miner server on " + c.miner_port + " port is already connected");
    return;
  }
  if (!c.is_quiet_mode) log("Miner server on " + c.miner_port + " port connected from " + miner_socket.remoteAddress);

  let miner_data_buff = "";

  miner_socket.on('data', function (msg) {
    miner_data_buff += msg;
    if (miner_data_buff.indexOf('\n') === -1) return;
    let messages = miner_data_buff.split('\n');
    let incomplete_line = miner_data_buff.slice(-1) === '\n' ? '' : messages.pop();
    for (let i = 0; i < messages.length; i++) {
      let message = messages[i];
      if (message.trim() === '') continue;
      try {
        const json = JSON.parse(message);
        if (c.is_debug) log("Miner message: " + JSON.stringify(json));
        if ("method" in json && json.method === "login") {
          miner_login_cb(json, miner_socket);
        } else if (curr_pool_socket) {
          curr_pool_socket.write(JSON.stringify(json) + "\n");
        } else {
          err("Can't write miner reply to the pool since its socket is closed");
        }
      } catch (e) {
        err("Can't parse message from the miner: " + message);
      }
    }
    miner_data_buff = incomplete_line;
  });
  miner_socket.on('end', function() {
    if (!c.is_quiet_mode) log("Miner socket was closed");
    if (curr_pool_socket && curr_miner_socket) err("Pool <-> miner link was broken due to closed miner socket");
    curr_miner_socket = null;
  });
  miner_socket.on('error', function() {
    err("Miner socket error");
    if (curr_pool_socket && curr_miner_socket) err("Pool <-> miner link was broken due to miner socket error");
    miner_socket.destroy();
    curr_miner_socket = null;
  });
});

function set_main_pool_check_timer() {
  log("Will retry connection attempt to the main pool in 90 seconds");
  return setTimeout(connect_pool, 90*1000, 0, pool_ok, pool_new_msg, set_main_pool_check_timer);
}

function pool_ok(pool_num, pool_socket) {
  if (pool_num) {
    if (!main_pool_check_timer) main_pool_check_timer = set_main_pool_check_timer();
  } else {
    if (main_pool_check_timer) {
      log("Stopped main pool connection attemps since its connection was established");
      clearTimeout(main_pool_check_timer);
      main_pool_check_timer = null;
    }
  }
  if (curr_pool_socket) {
    log("Closing " + c.pools[curr_pool_num] + " pool socket");
    curr_pool_socket.destroy();
  }
  log("Connected to " + c.pools[pool_num] + " pool");
  if (!curr_pool_socket && curr_miner_socket) log("Pool <-> miner link was established due to new pool connection");
  curr_pool_num = pool_num;
  curr_pool_socket = pool_socket;
}

function start_miner_raw(exe, args, out_cb) {
   const cmd = exe + " " + args.join(" ");
   log("Starting miner: " + cmd);
   let proc = child_process.spawn(exe, args, {});

   proc.stdout.on('data', (data) => {
     if (out_cb) out_cb(`${data}`);
   });
   proc.stderr.on('data', (data) => {
     if (out_cb) out_cb(`${data}`);
   });
   proc.on('close', (code) => {
     if (code) err("Miner '" + cmd + "' exited with nonzero code " + code);
     else if (!c.is_quiet_mode) log("Miner '" + cmd + "' exited with zero code");
   });
   proc.on('error', (error) => {
     err("Failed to start '" + cmd + "' miner: " + error);
   });
   return proc;
}

function print_all_messages(str) {
  process.stdout.write(str);
  if (c.log_file) fs.appendFileSync(c.log_file, str);
}

function print_messages(str) {
  if (!c.is_quiet_mode) print_all_messages(str);
}

function start_miner(cmd, out_cb) {
   let args = cmd.match(/"[^"]+"|'[^']+'|\S+/g);
   let exe = args.shift();
   return start_miner_raw(exe, args, out_cb);
}

function pool_new_msg(is_new_job, json) {
  if (is_new_job) {
    let next_algo = DEFAULT_ALGO;
    if ("params" in json && "algo" in json.params) next_algo = json.params.algo;
    else if ("algo" in json.result.job) next_algo = json.result.job.algo;
    if (!(next_algo in c.algos)) {
      err("Ignoring job with unknown algo " + next_algo + " sent by the pool");
      return;
    }
    const next_miner = c.algos[next_algo];
    if (!curr_miner || curr_miner != next_miner) {
      if (curr_miner && curr_miner_socket == null) {
        err("Ignoring job wit new algo since we still waiting for new miner to start");
        return;
      }
      curr_miner_socket = null;
      if (miner_proc) {
        log("Stopping '" + curr_miner + "' miner");
        miner_proc.on('close', (code) => { miner_proc = start_miner(next_miner, print_all_messages); });
        miner_proc.kill();
      } else {
        miner_proc = start_miner(next_miner, print_all_messages);
      }
      curr_miner = next_miner;
    }

    if ("params" in json) {
      if (curr_pool_job1) {
        curr_pool_job1.result.job = json.params;
      } else {
        err("Can not update current pool job since first job is missing");
      }
    } else {
      curr_pool_job1 = json;
    }
  }

  if (curr_miner_socket) curr_miner_socket.write(JSON.stringify(json) + "\n"); 
}

function pool_err() {
  if (curr_pool_socket && curr_miner_socket) err("Pool <-> miner link was broken due to pool socket error");
  curr_pool_socket = null;
  curr_pool_job1   = null;
  if (++ curr_pool_num >= c.pools.length) {
    log("Waiting 60 seconds before trying to connect to the same pools once again");
    setTimeout(connect_pool, 60*1000, curr_pool_num = 0, pool_ok, pool_new_msg, pool_err);
  } else {
    connect_pool(curr_pool_num, pool_ok, pool_new_msg, pool_err);
  }
}

function print_help() {
  console.log("Usage: mm.js [<config_file.json>] [options]");
  console.log("Adding algo switching support to *any* stratum miner");
  console.log("<config_file.json> is file name of config file to load before parsing options (mm.json by default)");
  console.log("Config file and options should define at least one pool and miner:");
  console.log("Options:");
  console.log("\t--pool=<pool> (-p):            \t<pool> is in pool_address:pool_port format");
  console.log("\t--port=<number>:               \tdefines port that will be used for miner connections (3333 by default)");
  console.log("\t--user=<wallet> (-u):          \t<wallet> to use as pool user login (will be taken from the first miner otherwise)");
  console.log("\t--pass=<miner_id>:             \t<miner_id> to use as pool pass login (will be taken from the first miner otherwise)");
  console.log("\t--perf_<algo_class>=<hashrate> \tSets hashrate for perf <algo_class> that is: " + Object.keys(c.algo_perf).join(", "));
  console.log("\t--miner=<command_line> (-m):   \t<command_line> to start smart miner that can report algo itself");
  console.log("\t--<algo>=<command_line>:       \t<command_line> to start miner for <algo> that can not report it itself");
  console.log("\t--quiet (-q):                  \tdo not show miner output during configuration and also less messages");
  console.log("\t--debug:                       \tshow pool and miner messages");
  console.log("\t--log=<file_name>:             \t<file_name> of output log");
  console.log("\t--no-config-save:              \tDo not save config file");
  console.log("\t--help (-help,-h,-?):          \tPrints this help text");
}

function set_first_miner_user_pass(json) {
  if (c.user === null && "params" in json && (json.params instanceof Object) && "login" in json.params) {
    c.user = json.params.login;
    log("Setting pool user to '" + c.user + "'");
  }
  if (c.pass === null && "params" in json && (json.params instanceof Object) && "pass" in json.params) {
    c.pass = json.params.pass;
    log("Setting pool pass to '" + c.pass + "'");
  }
}

function check_miners(smart_miners, miners, cb) {
  let check_miners = [];
  smart_miners.forEach(function (cmd) {
    check_miners.push(function(resolve) {
      let miner_proc = null;
      let timeout = setTimeout(function () {
        err("Miner '" + cmd + "' was not connected and will be ignored");
        miner_proc.on('close', (code) => { resolve(); });
        miner_proc.kill();
      }, 60*1000);
      miner_login_cb = function(json) {
        clearTimeout(timeout);
        set_first_miner_user_pass(json);
        if ("params" in json && (json.params instanceof Object) && "algo" in json.params && (json.params.algo instanceof Array)) {
          json.params.algo.forEach(function (algo) {
            if (!c.algos[algo]) {
              log("Setting " + algo + " algo to '" + cmd + "' miner");
              c.algos[algo] = cmd;
              c.algos[algo.replace('cryptonight', 'cn')] = cmd;
              c.algos[algo.replace('cn', 'cryptonight')] = cmd;
            } else err("Algo " + algo + " is already set to '" + c.algos[algo] + "' miner");
          });
        } else {
          err("Miner '" + cmd + "' does not report any algo and will be ignored");
        }
        miner_proc.on('close', (code) => { resolve(); });
        miner_proc.kill();
      };
      miner_proc = start_miner(cmd, print_messages);
    });
  });

  for (let algo in miners) {
    check_miners.push(function(resolve) {
      const cmd = miners[algo];
      let miner_proc = null;
      let timeout = setTimeout(function () {
        err("Miner '" + cmd + "' was not connected and will be ignored");
        miner_proc.on('close', (code) => { resolve(); });
        miner_proc.kill();
      }, 60*1000);
      miner_login_cb = function(json) {
        clearTimeout(timeout);
        set_first_miner_user_pass(json);
        if (!c.algos[algo]) {
          log("Setting " + algo + " algo to '" + cmd + "' miner");
          c.algos[algo] = cmd;
          c.algos[algo.replace('cryptonight', 'cn')] = cmd;
          c.algos[algo.replace('cn', 'cryptonight')] = cmd;
        } else err("Algo " + algo + " is already set to '" + c.algos[algo] + "' miner");
        miner_proc.on('close', (code) => { resolve(); });
        miner_proc.kill();
      };
      miner_proc = start_miner(cmd, print_messages);
    });
  }

  log("Checking miner configurations (make sure they all configured to connect to localhost:" + c.miner_port + " pool)");
  function next_miner_check() {
    if (check_miners.length === 0) return cb();
    const check_miner = check_miners.shift();
    check_miner(next_miner_check);
  }
  next_miner_check();
}

function load_config_file() {
  if (fs.existsSync(CONFIG_FILE)) {
    log("Loading " + CONFIG_FILE + " config file");
    const c2 = require(CONFIG_FILE);
    for (let x in c2) c[x] = c2[x];
    return true;
  } else {
    err("Config file " + CONFIG_FILE + " does not exists");
    return false;
  }
}

function parse_argv(cb) {
  let smart_miners = [];
  let miners = {};

  if (process.argv.length === 2) {
    if (!load_config_file()) {
      print_help();
      cb();
      return;
    }
  }

  process.argv.slice(2).forEach(function (val, index) {
    let m;
    if (index === 0) {
      if (m = val.match(/^(.+\.json)$/)) {
        CONFIG_FILE = m[1];
        load_config_file();
        return;
      } else {
        load_config_file();
      }
    }
    if (m = val.match(/^(?:--?help|-h|-\?)$/)) {
      print_help();
      process.exit(0);
    } else if (m = val.match(/^(?:--quiet|-q)$/)) {
      c.is_quiet_mode = true;
    } else if (m = val.match(/^--debug$/)) {
      c.is_debug = true;
    } else if (m = val.match(/^--no-config-save$/)) {
      c.is_no_config_save = true;
    } else if (m = val.match(/^(?:--log)=(.+)$/)) {
      log("Setting log file name to " + m[1]);
      c.log_file = m[1];
    } else if (m = val.match(/^(?:--pool|-p)=(.+)$/)) {
      if (m[1].split(/:/).length == 2) {
        log("Added pool '" + m[1] + "' to the list of pools");
        c.pools.push(m[1]);
      } else {
        log("Pool in invalid format '" + m[1] + "' is ignored, use pool_address:pool_port format");
      }
    } else if (m = val.match(/^--port=([\d\.]+)$/)) {
      log("Setting miner port to " + m[1]);
      c.miner_port = m[1];
    } else if (m = val.match(/^(?:--user|-u)=(.+)$/)) {
      log("Setting pool user to " + m[1]);
      c.user = m[1];
    } else if (m = val.match(/^(?:--perf_([^=]+))=([\d\.]+)$/)) {
      if (m[1] in c.algo_perf) {
        const hashrate = parseFloat(m[2]);
        log("Setting performance for " + m[1] + " algo class to " + hashrate);
        c.algo_perf[m[1]] = hashrate;
      } else {
        err("Ignoring unknown algo class " + m[1]);
      }
    } else if (m = val.match(/^(?:--pass)=(.+)$/)) {
      log("Setting pool pass to '" + m[1] + "'");
      c.pass = m[1];
    } else if (m = val.match(/^(?:--miner|-m)=(.+)$/)) {
      log("Adding smart miner: '" + m[1] + "'");
      smart_miners.push(m[1]);
    } else if (m = val.match(/^(?:--([^=]+))=(.+)$/)) {
      log("Adding " + m[1] + " algo miner: " + m[2]);
      miners[m[1]] = m[2];
    } else {
      err("Unknow option '" + val + "'");
    }
  });

  miner_server.listen(c.miner_port, "127.0.0.1", function() {
    log("Local miner server on " + c.miner_port + " port started");
    check_miners(smart_miners, miners, cb);
  });
}

function check_main_stuff() {
  if (c.pools.length == 0) {
    err("You should specify at least one pool");
    process.exit(1);
  }

  if (Object.keys(c.algos).length == 0) {
    err("You should specify at least one working miner");
    process.exit(1);
  }
}

function do_miner_perf_runs(cb) {
  let miner_perf_runs = [];
  for (let algo_class in c.algo_perf) {
    if (c.algo_perf[algo_class] || !(algo_perf_algo[algo_class] in c.algos)) continue;
    miner_perf_runs.push(function(resolve) {
      log("Checking miner performance for " + algo_class + " algo class");
      const cmd = c.algos[algo_perf_algo[algo_class]];
      let miner_proc = null;
      let timeout = setTimeout(function () {
        err("Can't find performance data in '" + cmd + "' miner output");
        miner_proc.on('close', (code) => { resolve(); });
        miner_proc.kill();
      }, 5*60*1000);
      miner_login_cb = function(json, miner_socket) {
        miner_socket.write('{"id":1,"jsonrpc":"2.0","error":null,"result":{"id":"benchmark","job":{"blob":"ff05feeaa0db054f15eca39c843cb82c15e5c5a7743e06536cb541d4e96e90ffd31120b7703aa90000000076a6f6e34a9977c982629d8fe6c8b45024cafca109eef92198784891e0df41bc03","algo":"' + algo_perf_algo[algo_class] + '","job_id":"benchmark1","target":"10000000","id":"benchmark"},"status":"OK"}}\n');
      };
      miner_proc = start_miner(cmd, function(str) {
        print_messages(str);
        str = str.replace(/\x1b\[[0-9;]*m/g, ""); // remove all colors
        for (let i in hashrate_regexes) {
          const hashrate_regex = hashrate_regexes[i];
          const m = str.match(hashrate_regex);
          if (m) {
            const hashrate = parseFloat(m[1]);
            log("Setting performance for " + algo_class + " algo class to " + hashrate);
            c.algo_perf[algo_class] = hashrate;
            miner_proc.on('close', (code) => { clearTimeout(timeout); resolve(); });
            miner_proc.kill();
            break;
          }
        }
      });
    });
  }

  function next_miner_perf_run() {
    if (miner_perf_runs.length === 0) return cb();
    const miner_perf_run = miner_perf_runs.shift();
    miner_perf_run(next_miner_perf_run);
  }
  next_miner_perf_run();
}

function print_params() {
  log("");
  log("SETUP COMPLETE");
  let str = JSON.stringify(c, null, " ");
  log(str);
  log("");
  log("Saving " + CONFIG_FILE + " config file");
  if (!c.is_no_config_save) fs.writeFile(CONFIG_FILE, str, function(err) { if (err) err("Error saving " + CONFIG_FILE + " file"); });
}

// *** main program

function main() {
  print_params();

  miner_login_cb = function(json, miner_socket) {
    if (curr_pool_socket && !curr_miner_socket) log("Pool <-> miner link was established due to new miner connection");
    curr_miner_socket = miner_socket;
    if (curr_pool_job1) {
      miner_socket.write(JSON.stringify(curr_pool_job1) + "\n"); 
    } else {
      err("No first pool job to send to the miner!");
    }
  };

  connect_pool(curr_pool_num = 0, pool_ok, pool_new_msg, pool_err);
};

log("Meta Miner " + VERSION);

parse_argv(function() {
  check_main_stuff();
  do_miner_perf_runs(main);
});
