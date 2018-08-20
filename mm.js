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

// *****************************************************************************
// *** DEPENDECIES                                                           ***
// *****************************************************************************

const fs            = require('fs');
const net           = require('net');
const tls           = require('tls');
const path          = require('path');
const child_process = require('child_process');

// *****************************************************************************
// *** CONSTS                                                                ***
// *****************************************************************************

const VERSION      = "v0.8";
const DEFAULT_ALGO = "cn/1"; // this is algo that is assumed to be sent by pool if its job does not contain algo stratum extension
const AGENT        = "Meta Miner " + VERSION;

const hashrate_regexes = [
  /\[[^\]]+\] speed 2.5s\/60s\/15m [\d\.]+ ([\d\.]+)\s/,       // for old xmrig
  /\[[^\]]+\] speed 10s\/60s\/15m [\d\.]+ ([\d\.]+)\s/,        // for new xmrig
  /Totals \(ALL\):\s+[\d\.]+\s+([1-9]\d*\.\d+|0\.[1-9]\d*)\s/, // xmr-stak
  /Total Speed: ([\d\.]+) H\/s,/,                              // claymore
];

// basic algo for each algo class that is used for performance measurements
const algo_perf_algo = {
  "cn":       "cn/1",
  "cn-fast":  "cn/msr",
  "cn-lite":  "cn-lite/1",
  "cn-heavy": "cn-heavy/0",
};

function algo_perf_class(algo) { // converts algo to algo class
   if (algo.indexOf("heavy") > -1) return "cn-heavy";
   if (algo.indexOf("lite")  > -1) return "cn-lite";
   if (algo.indexOf("msr")   > -1) return "cn-fast";
   return "cn";
}

// *****************************************************************************
// *** CONFIG                                                                ***
// *****************************************************************************

let console_file = process.cwd() + "/mm.json";

let c = {
  miner_host: "127.0.0.1",
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
  watchdog: 600,
  hashrate_watchdog: 0,
};

let is_quiet_mode     = false;
let is_verbose_mode   = false;
let is_no_config_save = false;
let is_debug          = false;

// *****************************************************************************
// *** WORKING STATE                                                         ***
// *****************************************************************************

let curr_miner_socket   = null;
let curr_pool_socket    = null;
let curr_pool_job1      = null;
let curr_miner          = null;
let curr_pool_num       = 0;
let last_miner_hashrate = null;
let is_want_miner_kill  = false; // true if we want to kill miner (otherwise it is restart if closed without a reason)
let curr_perf_class     = null;
let last_perf_class_change_time = null;

let main_pool_check_timer   = null;
let miner_proc              = null;
let miner_login_cb          = null;
let miner_last_message_time = null;

// *****************************************************************************
// *** FUNCTIONS                                                             ***
// *****************************************************************************

// *** inlined from tree_kill module

function tree_kill(pid, signal, callback) {
    var tree = {};
    var pidsToProcess = {};
    tree[pid] = [];
    pidsToProcess[pid] = 1;

    if (typeof signal === 'function' && callback === undefined) {
      callback = signal;
      signal = undefined;
    }

    switch (process.platform) {
    case 'win32':
        child_process.exec('taskkill /pid ' + pid + ' /T /F', {}, callback);
        break;
    case 'darwin':
        buildProcessTree(pid, tree, pidsToProcess, function (parentPid) {
          return child_process.spawn('pgrep', ['-P', parentPid]);
        }, function () {
            killAll(tree, signal, callback);
        });
        break;
    // case 'sunos':
    //     buildProcessTreeSunOS(pid, tree, pidsToProcess, function () {
    //         killAll(tree, signal, callback);
    //     });
    //     break;
    default: // Linux
        buildProcessTree(pid, tree, pidsToProcess, function (parentPid) {
          return child_process.spawn('ps', ['-o', 'pid', '--no-headers', '--ppid', parentPid]);
        }, function () {
            killAll(tree, signal, callback);
        });
        break;
    }
};

function killAll (tree, signal, callback) {
    var killed = {};
    try {
        Object.keys(tree).forEach(function (pid) {
            tree[pid].forEach(function (pidpid) {
                if (!killed[pidpid]) {
                    killPid(pidpid, signal);
                    killed[pidpid] = 1;
                }
            });
            if (!killed[pid]) {
                killPid(pid, signal);
                killed[pid] = 1;
            }
        });
    } catch (err) {
        if (callback) {
            return callback(err);
        } else {
            throw err;
        }
    }
    if (callback) {
        return callback();
    }
}

function killPid(pid, signal) {
    try {
        process.kill(parseInt(pid, 10), signal);
    }
    catch (err) {
        if (err.code !== 'ESRCH') throw err;
    }
}

function buildProcessTree (parentPid, tree, pidsToProcess, spawnChildProcessesList, cb) {
    var ps = spawnChildProcessesList(parentPid);
    var allData = '';
    ps.stdout.on('data', function (data) {
        var data = data.toString('ascii');
        allData += data;
    });

    var onClose = function (code) {
        delete pidsToProcess[parentPid];

        if (code != 0) {
            // no more parent processes
            if (Object.keys(pidsToProcess).length == 0) {
                cb();
            }
            return;
        }

        allData.match(/\d+/g).forEach(function (pid) {
          pid = parseInt(pid, 10);
          tree[parentPid].push(pid);
          tree[pid] = [];
          pidsToProcess[pid] = 1;
          buildProcessTree(pid, tree, pidsToProcess, spawnChildProcessesList, cb);
        });
    };

    ps.on('close', onClose);
}

// *** Console/log output

function log(msg) {
  console.log(">>> " + msg);
  if (c.log_file) fs.appendFileSync(c.log_file, ">>> " + msg + "\n");
}

function err(msg) {
  console.error("!!! " + msg);
  if (c.log_file) fs.appendFileSync(c.log_file, "!!! " + msg + "\n");
}

function print_all_messages(str) {
  process.stdout.write(str);
  if (c.log_file) fs.appendFileSync(c.log_file, str);
  if (c.hashrate_watchdog) {
    const str2 = str.replace(/\x1b\[[0-9;]*m/g, ""); // remove all colors
    for (let i in hashrate_regexes) {
      const hashrate_regex = hashrate_regexes[i];
      const m = str2.match(hashrate_regex);
      if (m) last_miner_hashrate = parseFloat(m[1]);
    }
  }
}

function print_messages(str) {
  if (!is_quiet_mode) print_all_messages(str);
}

// *** Miner socket processing

let miner_server = net.createServer(function (miner_socket) {
  if (curr_miner_socket) {
    err("Miner server on " + c.miner_host + ":" + c.miner_port + " port is already connected (please make sure you do not have other miner running)");
    return;
  }
  if (is_verbose_mode) log("Miner server on " + + c.miner_host + ":" + c.miner_port + " port connected from " + miner_socket.remoteAddress);

  let miner_data_buff = "";

  miner_socket.on('data', function (msg) {
    miner_data_buff += msg;
    if (miner_data_buff.indexOf('\n') === -1) return;
    let messages = miner_data_buff.split('\n');
    let incomplete_line = miner_data_buff.slice(-1) === '\n' ? '' : messages.pop();
    for (let i = 0; i < messages.length; i++) {
      let message = messages[i];
      if (message.trim() === '') continue;
      let json;
      try {
        json = JSON.parse(message);
      } catch (e) {
        err("Can't parse message from the miner: " + message);
        continue;
      }
      if (is_debug) log("Miner message: " + JSON.stringify(json));
      const is_keepalived = "method" in json && json.method === "keepalived";
      if ("method" in json && json.method === "login") {
        miner_login_cb(json, miner_socket);
      } else if (curr_pool_socket) {
        curr_pool_socket.write(JSON.stringify(json) + "\n");
      } else if (!is_keepalived) {
        err("Can't write miner reply to the pool since its socket is closed");
      }
      if (!is_keepalived) miner_last_message_time = Date.now();
    }
    miner_data_buff = incomplete_line;
  });
  miner_socket.on('end', function() {
    if (is_verbose_mode) log("Miner socket was closed");
    if (curr_pool_socket && curr_miner_socket) err("Pool (" + c.pools[curr_pool_num] + ") <-> miner link was broken due to closed miner socket");
    curr_miner_socket = null;
  });
  miner_socket.on('error', function() {
    err("Miner socket error");
    if (curr_pool_socket && curr_miner_socket) err("Pool (" + c.pools[curr_pool_num] + ") <-> miner link was broken due to miner socket error");
    miner_socket.destroy();
    curr_miner_socket = null;
  });
});

// *** Miner start helpers

function start_miner_raw(exe, args, out_cb) {
   const cmd = exe + " " + args.join(" ");
   if (is_verbose_mode) log("Starting miner: " + cmd);
   last_miner_hashrate = null;
   last_perf_class_change_time = null;
   is_want_miner_kill = false;
   let proc = child_process.spawn(exe, args, {});

   proc.stdout.on('data', (data) => {
     if (out_cb) out_cb(`${data}`);
   });
   proc.stderr.on('data', (data) => {
     if (out_cb) out_cb(`${data}`);
   });
   proc.on('close', (code) => {
     if (is_verbose_mode) {
       if (code) err("Miner '" + cmd + "' exited with nonzero code " + code);
       else log("Miner '" + cmd + "' exited with zero code");
     }
     if (curr_pool_socket && !is_want_miner_kill) {
       log("Restarting '" + cmd + "' miner that was closed unexpectedly");
       miner_proc = start_miner_raw(exe, args, out_cb);
     }
   });
   proc.on('error', (error) => {
     err("Failed to start '" + cmd + "' miner: " + error);
   });
   return proc;
}

function start_miner(cmd, out_cb) {
   let args = cmd.match(/"[^"]+"|'[^']+'|\S+/g);
   let exe = args.shift();
   return start_miner_raw(exe, args, out_cb);
}
 
// *** Pool socket processing

function connect_pool(pool_num, pool_ok_cb, pool_new_msg_cb, pool_err_cb) {
  let pool_address_parts = c.pools[pool_num].split(/:/);

  const host = pool_address_parts[0];
  let   port = pool_address_parts[1];
  let m = port.match(/^(?:ssl|tls)(\d+)$/);
  let is_tls = false;
  if (m) { is_tls = true; port = m[1]; }
  let pool_socket = is_tls ? tls.connect(port, host, { rejectUnauthorized: false }) : net.connect(port, host);

  pool_socket.on('connect', function () {
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
      let json;
      try {
        json = JSON.parse(message);
      } catch (e) {
        err("Can't parse message from the pool (" + c.pools[pool_num] + "): " + message);
        continue;
      }
      if (is_debug) log("Pool message: " + JSON.stringify(json));
      const is_new_job = ("result" in json && (json.result instanceof Object) && "job" in json.result && (json.result.job instanceof Object)) ||
                         ("method" in json && json.method === "job" && "params" in json && (json.params instanceof Object));
      if (is_new_job) {
        if (!is_pool_ok) { pool_ok_cb(pool_num, pool_socket); is_pool_ok = true; }
      }
      if (is_pool_ok) pool_new_msg_cb(is_new_job, json);
      else err("Ignoring pool (" + c.pools[pool_num] + ") message that does not contain job: " + JSON.stringify(json));
    }
    pool_data_buff = incomplete_line;
    
  });

  pool_socket.on('end', function() {
    pool_socket.destroy();
    if (!is_pool_ok) {
      err("Pool (" + c.pools[pool_num] + ") socket closed before sending first job");
      pool_err_cb(pool_num);
    } else if (is_verbose_mode) log("Pool (" + c.pools[pool_num] + ") socket closed");
  });

  pool_socket.on('error', function() {
    err("Pool (" + c.pools[pool_num] + ") socket error");
    pool_socket.destroy();
    pool_err_cb(pool_num);
  });
}
           
// *** connect_pool function callbacks

function set_main_pool_check_timer() {
  if (is_verbose_mode) log("Will retry connection attempt to the main pool in 90 seconds");
  main_pool_check_timer = setTimeout(connect_pool, 90*1000, 0, pool_ok, pool_new_msg, pool_err);
}

function pool_ok(pool_num, pool_socket) {
  if (pool_num) {
    if (!main_pool_check_timer) set_main_pool_check_timer();
  } else {
    if (main_pool_check_timer) {
      if (is_verbose_mode) log("Stopped main pool connection attemps since its connection was established");
      clearTimeout(main_pool_check_timer);
      main_pool_check_timer = null;
    }
  }
  if (curr_pool_socket) {
    if (is_verbose_mode) log("Closing " + c.pools[curr_pool_num] + " pool socket");
    curr_pool_socket.destroy();
  }
  if (!is_quiet_mode) log("Connected to " + c.pools[pool_num] + " pool");
  if (!curr_pool_socket && curr_miner_socket) log("Pool (" + c.pools[pool_num] + ") <-> miner link was established due to new pool connection");
  curr_pool_num = pool_num;
  curr_pool_socket = pool_socket;
}

function replace_miner(next_miner) {
  if (miner_proc) {
    if (is_verbose_mode) log("Stopping '" + curr_miner + "' miner");
    miner_proc.on('close', (code) => { miner_proc = start_miner(next_miner, print_all_messages); });
    is_want_miner_kill = true;
    tree_kill(miner_proc.pid);
  } else {
    miner_proc = start_miner(next_miner, print_all_messages);
  }
}

function pool_new_msg(is_new_job, json) {
  if (is_new_job) {
    let next_algo = DEFAULT_ALGO;
    if ("params" in json && "algo" in json.params) next_algo = json.params.algo;
    else if ("algo" in json.result.job) next_algo = json.result.job.algo;
    if (!(next_algo in c.algos)) {
      err("Ignoring job with unknown algo " + next_algo + " sent by the pool (" + c.pools[curr_pool_num] + ")");
      return;
    }
    const next_perf_class = algo_perf_class(next_algo);
    if (curr_perf_class != next_perf_class) last_perf_class_change_time = Date.now();
    curr_perf_class = next_perf_class;
    const next_miner = c.algos[next_algo];
    if (!curr_miner || curr_miner != next_miner) {
      if (curr_miner && curr_miner_socket == null) {
        err("Ignoring job with new algo " + next_algo + " from the pool (" + c.pools[curr_pool_num] + ") since we still waiting for new miner to start");
        return;
      }
      curr_miner_socket = null;
      if (!is_quiet_mode) log("Starting miner '" + next_miner + "' to process new " + next_algo + " algo");
      curr_miner = next_miner;
      replace_miner(next_miner);
    }

    if ("params" in json) {
      if (curr_pool_job1) {
        curr_pool_job1.result.job = json.params;
      } else {
        err("[INTERNAL ERROR] Can not update pool (" + c.pools[curr_pool_num] + ") job since its first job is missing");
      }
    } else {
      curr_pool_job1 = json;
    }
  }

  if (curr_miner_socket) curr_miner_socket.write(JSON.stringify(json) + "\n"); 
}

function pool_err(pool_num) {
  if (pool_num === 0 && curr_pool_num) { // this is main pool attept error while we are on backup pool
    if (!main_pool_check_timer) err("[INTERNAL ERROR] Unexpected main_pool_check_timer state in pool_err");
    set_main_pool_check_timer();
    return;
  }
  if (curr_pool_num != pool_num) err("[INTERNAL ERROR] Unexpected pool_num in pool_err");
  if (curr_pool_socket && curr_miner_socket) err("Pool (" + c.pools[pool_num] + ") <-> miner link was broken due to pool socket error");
  curr_pool_socket = null;
  curr_pool_job1   = null;
  if (++ curr_pool_num >= c.pools.length) {
    if (is_verbose_mode) log("Waiting 60 seconds before trying to connect to the same pools once again");
    setTimeout(connect_pool, 60*1000, curr_pool_num = 0, pool_ok, pool_new_msg, pool_err);
  } else {
    connect_pool(curr_pool_num, pool_ok, pool_new_msg, pool_err);
  }
}

// *** Miner execution checks

function set_first_miner_user_pass(json) {
  if (c.user === null && "params" in json && (json.params instanceof Object) && "login" in json.params) {
    c.user = json.params.login;
    if (is_verbose_mode) log("Setting pool user to '" + c.user + "'");
  }
  if (c.pass === null && "params" in json && (json.params instanceof Object) && "pass" in json.params) {
    c.pass = json.params.pass;
    if (is_verbose_mode) log("Setting pool pass to '" + c.pass + "'");
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
        tree_kill(miner_proc.pid);
      }, 60*1000);
      miner_login_cb = function(json) {
        clearTimeout(timeout);
        set_first_miner_user_pass(json);
        if ("params" in json && (json.params instanceof Object) && "algo" in json.params && (json.params.algo instanceof Array)) {
          json.params.algo.forEach(function (algo) {
            if (is_verbose_mode) {
              if (c.algos[algo]) log("Setting " + algo + " algo from '" + c.algos[algo] + "' to '" + cmd + "' miner");
              else log("Setting " + algo + " algo to '" + cmd + "' miner");
            }
            c.algos[algo] = cmd;
            c.algos[algo.replace('cryptonight', 'cn')] = cmd;
            c.algos[algo.replace('cn', 'cryptonight')] = cmd;
          });
        } else {
          err("Miner '" + cmd + "' does not report any algo and will be ignored");
        }
        miner_proc.on('close', (code) => { resolve(); });
        tree_kill(miner_proc.pid);
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
        tree_kill(miner_proc.pid);
      }, 60*1000);
      miner_login_cb = function(json) {
        clearTimeout(timeout);
        set_first_miner_user_pass(json);
        if (is_verbose_mode) {
          if (c.algos[algo]) log("Setting " + algo + " algo from '" + c.algos[algo] + "' to '" + cmd + "' miner");
          else log("Setting " + algo + " algo to '" + cmd + "' miner");
        }
        c.algos[algo] = cmd;
        c.algos[algo.replace('cryptonight', 'cn')] = cmd;
        c.algos[algo.replace('cn', 'cryptonight')] = cmd;
        miner_proc.on('close', (code) => { resolve(); });
        tree_kill(miner_proc.pid);
      };
      miner_proc = start_miner(cmd, print_messages);
    });
  }

  if (!is_quiet_mode && check_miners.length) log("Checking miner configurations (make sure they all configured to connect to " + c.miner_host + ":" + c.miner_port + " pool)");
  function next_miner_check() {
    if (check_miners.length === 0) return cb();
    const check_miner = check_miners.shift();
    check_miner(next_miner_check);
  }
  next_miner_check();
}

// *** Miner performance runs

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
        tree_kill(miner_proc.pid);
      }, 5*60*1000);
      miner_login_cb = function(json, miner_socket) {
        miner_socket.write('{"id":1,"jsonrpc":"2.0","error":null,"result":{"id":"benchmark","job":{"blob":"7f7ffeeaa0db054f15eca39c843cb82c15e5c5a7743e06536cb541d4e96e90ffd31120b7703aa90000000076a6f6e34a9977c982629d8fe6c8b45024cafca109eef92198784891e0df41bc03","algo":"' + algo_perf_algo[algo_class] + '","job_id":"benchmark1","target":"10000000","id":"benchmark"},"status":"OK"}}\n');
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
            tree_kill(miner_proc.pid);
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

// *** Command line option handling

function print_help() {
  console.log("Usage: mm.js [<config_file.json>] [options]");
  console.log("Adding algo switching support to *any* stratum miner");
  console.log("<config_file.json> is file name of config file to load before parsing options (mm.json by default)");
  console.log("Config file and options should define at least one pool and miner:");
  console.log("Options:");
  console.log("\t--pool=<pool> (-p):            \t<pool> is in pool_address:pool_port format, where pool_port can be <port_number> or ssl<port_number>");
  console.log("\t--host=<hostname>:             \tdefines host that will be used for miner connections (localhost 127.0.0.1 by default)");
  console.log("\t--port=<number>:               \tdefines port that will be used for miner connections (3333 by default)");
  console.log("\t--user=<wallet> (-u):          \t<wallet> to use as pool user login (will be taken from the first miner otherwise)");
  console.log("\t--pass=<miner_id>:             \t<miner_id> to use as pool pass login (will be taken from the first miner otherwise)");
  console.log("\t--perf_<algo_class>=<hashrate> \tSets hashrate for perf <algo_class> that is: " + Object.keys(c.algo_perf).join(", "));
  console.log("\t--miner=<command_line> (-m):   \t<command_line> to start smart miner that can report algo itself");
  console.log("\t--<algo>=<command_line>:       \t<command_line> to start miner for <algo> that can not report it itself");
  console.log("\t--watchdog=<seconds> (-w):     \trestart miner if is does not submit work for <seconds> (600 by default, 0 to disable)");
  console.log("\t--hashrate_watchdog=<percent>: \trestart miner if is hashrate dropped below <percent> value of of its expected hashrate (0 by default to disable)");
  console.log("\t--quiet (-q):                  \tdo not show miner output during configuration and also less messages");
  console.log("\t--verbose (-v):                \tshow more messages");
  console.log("\t--debug:                       \tshow pool and miner messages");
  console.log("\t--log=<file_name>:             \t<file_name> of output log");
  console.log("\t--no-config-save:              \tDo not save config file");
  console.log("\t--help (-help,-h,-?):          \tPrints this help text");
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
        console_file = m[1];
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
      is_quiet_mode = true;
    } else if (m = val.match(/^(?:--verbose|-v)$/)) {
      is_verbose_mode = true;
    } else if (m = val.match(/^--debug$/)) {
      is_debug = true;
    } else if (m = val.match(/^--no-config-save$/)) {
      is_no_config_save = true;
    } else if (m = val.match(/^--log=(.+)$/)) {
      if (is_verbose_mode) log("Setting log file name to " + m[1]);
      c.log_file = m[1];
    } else if (m = val.match(/^(?:--watchdog|w)=(.+)$/)) {
      const number = parseInt(m[1]);
      if (is_verbose_mode) log("Setting watchdog timeout to " + (number ? number : "disabled"));
      c.watchdog = number;
    } else if (m = val.match(/^--hashrate_watchdog=(.+)$/)) {
      const number = parseInt(m[1]);
      const percent = number > 100 ? 100 : number;
      if (is_verbose_mode) log("Setting hashrate watchdog timeout to " + (percent ? percent + "%" : "disabled"));
      c.hashrate_watchdog = percent;
    } else if (m = val.match(/^(?:--pool|-p)=(.+)$/)) {
      if (m[1].split(/:/).length == 2) {
        if (is_verbose_mode) log("Added pool '" + m[1] + "' to the list of pools");
        if (c.pools.indexOf(m[1]) == -1) c.pools.push(m[1]);
      } else {
        err("Pool in invalid format '" + m[1] + "' is ignored, use <pool_address>:<pool_port> (or <pool_address>:ssl<pool_port>) format");
      }
    } else if (m = val.match(/^--host=(.+)$/)) {
      if (is_verbose_mode) log("Setting miner host to " + m[1]);
      c.miner_host = m[1];
    } else if (m = val.match(/^--port=([\d\.]+)$/)) {
      const number = parseInt(m[1]);
      if (is_verbose_mode) log("Setting miner port to " + number);
      c.miner_port = number;
    } else if (m = val.match(/^(?:--user|-u)=(.+)$/)) {
      if (is_verbose_mode) log("Setting pool user to " + m[1]);
      c.user = m[1];
    } else if (m = val.match(/^(?:--perf_([^=]+))=([\d\.]+)$/)) {
      if (m[1] in c.algo_perf) {
        const hashrate = parseFloat(m[2]);
        if (is_verbose_mode) log("Setting performance for " + m[1] + " algo class to " + hashrate);
        c.algo_perf[m[1]] = hashrate;
      } else {
        err("Ignoring unknown algo class " + m[1] + ". Please use one of these: " + Object.keys(c.algo_perf).join(", "));
      }
    } else if (m = val.match(/^(?:--pass)=(.+)$/)) {
      if (is_verbose_mode) log("Setting pool pass to '" + m[1] + "'");
      c.pass = m[1];
    } else if (m = val.match(/^(?:--miner|-m)=(.+)$/)) {
      if (is_verbose_mode) log("Adding smart miner: '" + m[1] + "'");
      smart_miners.push(m[1]);
    } else if (m = val.match(/^(?:--([^=]+))=(.+)$/)) {
      if (is_verbose_mode) log("Adding " + m[1] + " algo miner: " + m[2]);
      miners[m[1]] = m[2];
    } else {
      err("Ignoring unknown option '" + val + "'");
    }
  });

  miner_server.listen(c.miner_port, c.miner_host, function() {
    if (is_verbose_mode) log("Local miner server on " + c.miner_host + ":" + c.miner_port + " port started");
    check_miners(smart_miners, miners, cb);
  });
}

// *** Load/save config file

function load_config_file() {
  const config_file_abs = path.resolve(console_file);
  if (fs.existsSync(config_file_abs)) {
    if (is_verbose_mode) log("Loading " + config_file_abs + " config file");
    const c2 = require(config_file_abs);
    for (let x in c2) c[x] = c2[x];
    return true;
  } else {
    err("Config file " + config_file_abs + " does not exists");
    return false;
  }
}

function print_params() {
  let str = JSON.stringify(c, null, " ");
  if (is_verbose_mode) {
    log("");
    log("SETUP COMPLETE");
    log(str);
    log("");
    log("Saving " + console_file + " config file");
  }
  if (!is_no_config_save) fs.writeFile(console_file, str, function(error) { if (error) err("Error saving " + console_file + " file"); });
}

// *****************************************************************************
// *** MAIN PROGRAM                                                          ***
// *****************************************************************************

function main() {
  print_params();

  log("POOL USER: '" + c.user + "', PASS: '" + c.pass + "'");

  miner_login_cb = function(json, miner_socket) {
    if (curr_pool_socket && !curr_miner_socket) log("Pool (" + c.pools[curr_pool_num] + ") <-> miner link was established due to new miner connection");
    curr_miner_socket = miner_socket;
    if (curr_pool_job1) {
      miner_socket.write(JSON.stringify(curr_pool_job1) + "\n"); 
    } else {
      err("No pool (" + c.pools[curr_pool_num] + ") job to send to the miner!");
    }
  };

  if (c.watchdog) {
    if (is_verbose_mode) log("Starting miner watchdog timer (with " + c.watchdog + " seconds max since last miner result)");
    setInterval(function () {
      if (!curr_pool_socket || !curr_miner_socket) return;
      const miner_idle_time = (Date.now() - miner_last_message_time) / 1000;
      if (miner_idle_time > c.watchdog) {
        err("No results from miner for more than " + c.watchdog + " seconds. Restarting it...");
        replace_miner(curr_miner);
      }
    }, 60*1000);
  }

  if (c.hashrate_watchdog) {
    if (is_verbose_mode) log("Starting miner hashrate watchdog timer (with " + c.hashrate_watchdog + "% min hashrate threshold)");
    setInterval(function () {
      if (!curr_pool_socket || !curr_miner_socket || last_miner_hashrate === null) return;
      // there was perf class change without miner restart so we need to wait for at least 15 minutes for hashrate to be correct
      if (last_perf_class_change_time && Date.now() - last_perf_class_change_time < 15*60*1000) return;
      const min_hashrate = c.algo_perf[curr_perf_class] * c.hashrate_watchdog / 100;
      if (last_miner_hashrate < min_hashrate) {
        err("Current miner hashrate " + last_miner_hashrate + " is below minimum " + min_hashrate + " hashrate theshold. Restarting it...");
        replace_miner(curr_miner);
      }
    }, 60*1000);
  }

  connect_pool(curr_pool_num = 0, pool_ok, pool_new_msg, pool_err);
};

log("Meta Miner " + VERSION);

parse_argv(function() {
  if (c.pools.length == 0) {
    err("[FATAL] You must specify at least one pool");
    process.exit(1);
  }

  if (Object.keys(c.algos).length == 0) {
    err("[FATAL] You must specify at least one working miner");
    process.exit(1);
  }

  do_miner_perf_runs(main);
});
