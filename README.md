# meta-miner
Meta Miner: allows to add algo switching support to *any* stratum miner.

Does not add any extra mining fees.

## Check mm.js builtin help

```
Usage: mm.js [<config_file.json>] [options]
Adding algo switching support to *any* stratum miner
<config_file.json> is file name of config file to load before parsing options (mm.json by default)
Config file and options should define at least one pool and miner:
Options:
        --pool=<pool> (-p):             <pool> is in pool_address:pool_port format, where pool_port can be <port_number> or ssl<port_number>
        --host=<hostname>:              defines host that will be used for miner connections (localhost 127.0.0.1 by default)
        --port=<number>:                defines port that will be used for miner connections (3333 by default)
        --user=<wallet> (-u):           <wallet> to use as pool user login (will be taken from the first miner otherwise)
        --pass=<miner_id>:              <miner_id> to use as pool pass login (will be taken from the first miner otherwise)
        --perf_<algo_class>=<hashrate>  Sets hashrate for perf <algo_class> that is: cn, cn/2, cn/msr, cn-lite, cn-heavy
        --algo_min_time=<seconds>       Sets <seconds> minimum time pool should keep our miner on one algo (0 default, set higher for starting miners)
        --miner=<command_line> (-m):    <command_line> to start smart miner that can report algo itself
        --<algo>=<command_line>:        <command_line> to start miner for <algo> that can not report it itself
        --watchdog=<seconds> (-w):      restart miner if is does not submit work for <seconds> (600 by default, 0 to disable)
        --hashrate_watchdog=<percent>:  restart miner if is hashrate dropped below <percent> value of of its expected hashrate (0 by default to disable)
        --quiet (-q):                   do not show miner output during configuration and also less messages
        --verbose (-v):                 show more messages
        --debug:                        show pool and miner messages
        --log=<file_name>:              <file_name> of output log
        --no-config-save:               Do not save config file
        --help (-help,-h,-?):           Prints this help text
```

Check https://github.com/xmrig/xmrig-proxy/blob/master/doc/STRATUM_EXT.md#14-algorithm-names-and-variants for list of possible algo names.

## Sample mm.json (to use with xmrig v2.8.0+ located in the same directory)

```
{
 "miner_port": 3333,
 "pools": [
   "gulf.moneroocean.stream:10001"
 ],
 "algos": {
  "cn/1": "./xmrig --config=config.json",
  "cn/2": "./xmrig --config=config.json",
  "cn/xtl": "./xmrig --config=config.json",
  "cn/msr": "./xmrig --config=config.json",
  "cn/xao": "./xmrig --config=config.json",
  "cn/rto": "./xmrig --config=config.json",
  "cn-heavy/0": "./xmrig --config=config-heavy.json",
  "cn-heavy/tube": "./xmrig --config=config-heavy.json",
  "cn-heavy/xhv": "./xmrig --config=config-heavy.json",
  "cn-lite/1": "./xmrig --config=config-lite.json"
 },
 "algo_perf": {
  "cn": 30.2,
  "cn/2": 38,
  "cn/msr": 57.6,
  "cn-lite": 109.1,
  "cn-heavy": 27
 },
 "user": "44qJYxdbuqSKarYnDSXB6KLbsH4yR65vpJe3ELLDii9i4ZgKpgQXZYR4AMJxBJbfbKZGWUxZU42QyZSsP4AyZZMbJBCrWr1",
 "pass": "x",
 "log_file": null,
 "watchdog": 600,
 "hashrate_watchdog": 0
}
```

## General configuration guidelines

* Configure your miners to connect to the single localhost:3333 (non SSL/TLS) pool.

* For best results separate xmr-stak CPU and GPU miners (by using --noCPU, --noAMD, --noNVIDIA options).

* Prepare your miner config files that give the best performance for your hardware on cryptonight, cryptonight-lite and cryptonight-heavy algorithm classes.

* If you have several miners on one host use mm.js --port option to assign them to different ports.

* Additional mm.js pools will be used as backup pools.

* To rerun benchmark for specific algorithm class use --perf_<algo_class>=0 option.

## Usage examples on Windows

Place mm.exe or mm.js (with nodejs installed) into unpacked miner directory either by:

* Download and unpack the latest mm-vX.X.zip from https://github.com/MoneroOcean/meta-miner/releases

* Download and install nodejs using https://nodejs.org/dist/v8.11.3/node-v8.11.3-x64.msi installator and download and unpack https://raw.githubusercontent.com/MoneroOcean/meta-miner/master/mm.js


### Usage example with xmrig-amd on Windows

* Download and unpack the lastest xmrig-amd (https://github.com/xmrig/xmrig-amd/releases/download/v2.7.3-beta/xmrig-amd-2.7.3-beta-win64.zip).

* Modify config.json file in xmrig-amd directory this way and adjust it for the best threads performance (out of scope of this guide):

	* Set "url" to "localhost:3333"
	* Set "user" to "44qJYxdbuqSKarYnDSXB6KLbsH4yR65vpJe3ELLDii9i4ZgKpgQXZYR4AMJxBJbfbKZGWUxZU42QyZSsP4AyZZMbJBCrWr1" (put your Monero address)

* Copy config.json to config-lite.json, put "algo" to "cryptonight-lite/1" in config-lite.json and adjust it for the best threads performance (out of scope of this guide).

* Copy config.json to config-heavy.json, put "algo" to "cryptonight-heavy/0" in config-heavy.json and adjust it for the best threads performance (out of scope of this guide).

* Run Meta Miner (or use "node mm.js" instead of mm.exe):

```shell
mm.exe -p=gulf.moneroocean.stream:10001 -m="xmrig-amd.exe --config=config.json" -m="xmrig-amd.exe --config=config-heavy.json" -m="xmrig-amd.exe --config=config-lite.json"
```

### Usage example with xmr-stak (AMD only) on Windows

* Download and unpack the lastest xmr-stak (https://github.com/fireice-uk/xmr-stak/releases/download/2.4.7/xmr-stak-win64.zip).

* Configure xmr-stak this way (put your Monero address):

```
- Please enter the currency that you want to mine:
  ...
cryptonight_v7
- Pool address: e.g. pool.example.com:3333
localhost:3333
- Username (wallet address or pool login):
44qJYxdbuqSKarYnDSXB6KLbsH4yR65vpJe3ELLDii9i4ZgKpgQXZYR4AMJxBJbfbKZGWUxZU42QyZSsP4AyZZMbJBCrWr1
```

* Enable hashrate output by setting "verbose_level" to 4 in config.txt so it can be collected by mm.js (also set "flush_stdout" to true for older xmr-stak versions).

* Copy amd.txt to amd-lite.txt and amd-heavy.txt and adjust all of them for the best threads performance (out of scope of this guide).

* Run Meta Miner (or use "node mm.js" instead of mm.exe):

```shell
mm.exe -p=gulf.moneroocean.stream:10001 --cn/1="xmr-stak.exe --noCPU --currency cryptonight_v7 --amd amd.txt" --cn/msr="xmr-stak.exe --noCPU --currency cryptonight_masari --amd amd.txt" --cn-lite/1="xmr-stak.exe --noCPU --currency cryptonight_lite_v7 --amd amd-lite.txt" --cn-heavy/0="xmr-stak.exe --noCPU --currency cryptonight_heavy --amd amd-heavy.txt" --cn-heavy/xhv="xmr-stak.exe --noCPU --currency cryptonight_haven --amd amd-heavy.txt" --cn-heavy/tube="xmr-stak.exe --noCPU --currency cryptonight_bittube2 --amd amd-heavy.txt"
```
* To run Meta Miner for xmr-stak CPU/GPU use this command:

```shell
mm.exe -p=gulf.moneroocean.stream:10001 --cn/1="xmr-stak.exe --currency cryptonight_v7 --cpu cpu.txt --amd amd.txt" --cn/msr="xmr-stak.exe --currency cryptonight_masari --cpu cpu.txt --amd amd.txt" --cn-lite/1="xmr-stak.exe --currency cryptonight_lite_v7 --cpu cpu-lite.txt --amd amd-lite.txt" --cn-heavy/0="xmr-stak.exe --currency cryptonight_heavy --cpu cpu-heavy.txt --amd amd-heavy.txt" --cn-heavy/xhv="xmr-stak.exe --currency cryptonight_haven --cpu cpu-heavy.txt --amd amd-heavy.txt" --cn-heavy/tube="xmr-stak.exe --currency cryptonight_bittube2 --cpu cpu-heavy.txt --amd amd-heavy.txt"
```

## Usage examples on Linux (Ubuntu 16.04)

Get node and Meta Miner (mm.js) in the miner directory:

```shell
sudo apt-get update
sudo apt-get install -y nodejs-legacy
wget https://raw.githubusercontent.com/MoneroOcean/meta-miner/master/mm.js
chmod +x mm.js
```

### Usage example with xmrig on Linux

* Get xmrig:

```shell
wget https://github.com/xmrig/xmrig/releases/download/v2.6.4/xmrig-2.6.4-xenial-amd64.tar.gz
tar xf xmrig-2.6.4-xenial-amd64.tar.gz
cd xmrig-2.6.4/
```

* Prepare configs for different algorithms (put your Monero address):

```shell
sed -i 's/"url": *"[^"]*",/"url": "localhost:3333",/' config.json
sed -i 's/"user": *"[^"]*",/"user": "44qJYxdbuqSKarYnDSXB6KLbsH4yR65vpJe3ELLDii9i4ZgKpgQXZYR4AMJxBJbfbKZGWUxZU42QyZSsP4AyZZMbJBCrWr1",/' config.json
cp config.json config-heavy.json
cp config.json config-lite.json
sed -i 's/"algo": *"[^"]*",/"algo": "cryptonight-heavy\/0",/' config-heavy.json
sed -i 's/"algo": *"[^"]*",/"algo": "cryptonight-lite\/1",/' config-lite.json
```

* Run Meta Miner:

```shell
./mm.js -p=gulf.moneroocean.stream:10001 -m="./xmrig --config=config.json" -m="./xmrig --config=config-heavy.json" -m="./xmrig --config=config-lite.json"
```

### Usage example with xmr-stak (CPU only) on Linux

* Configure xmr-stak this way (put your Monero address):

```
- Please enter the currency that you want to mine:
  ...
cryptonight_v7
- Pool address: e.g. pool.example.com:3333
localhost:3333
- Username (wallet address or pool login):
44qJYxdbuqSKarYnDSXB6KLbsH4yR65vpJe3ELLDii9i4ZgKpgQXZYR4AMJxBJbfbKZGWUxZU42QyZSsP4AyZZMbJBCrWr1
```

* Enable hashrate output so it can be collected by mm.js and disable output flush (for older xmr-stak versions):

```shell
sed -i 's/"verbose_level" : 3,/"verbose_level" : 4,/' config.txt
sed -i 's/"flush_stdout" : false,/"flush_stdout" : true,/' config.txt
```

* Prepare and adjust configs for different algorithms:

```shell
cp cpu.txt cpu-lite.txt
cp cpu.txt cpu-heavy.txt
```

* Run Meta Miner:

```shell
./mm.js -p=gulf.moneroocean.stream:10001 --cn/1="./bin/xmr-stak --currency cryptonight_v7 --cpu cpu.txt" --cn/msr="./bin/xmr-stak --currency cryptonight_masari --cpu cpu.txt" --cn-lite/1="./bin/xmr-stak --currency cryptonight_lite_v7 --cpu cpu-lite.txt" --cn-heavy/0="./bin/xmr-stak --currency cryptonight_heavy --cpu cpu-heavy.txt" --cn-heavy/xhv="./bin/xmr-stak --currency cryptonight_haven --cpu cpu-heavy.txt" --cn-heavy/tube="./bin/xmr-stak --currency cryptonight_bittube2 --cpu cpu-heavy.txt"
```
