# meta-miner
Meta Miner: allows to add algo switching support to *any* stratum miner

# Check mm.js builtin help

```
Usage: mm.js [<config_file.json>] [options]
Adding algo switching support to *any* stratum miner
<config_file.json> is file name of config file to load before parsing options (mm.json by default)
Config file and options should define at least one pool and miner:
Options:
        --pool=<pool> (-p):             <pool> is in pool_address:pool_port format
        --port=<number>:                defines port that will be used for miner connections (3333 by default)
        --user=<wallet> (-u):           <wallet> to use as pool user login (will be taken from the first miner otherwise)
        --pass=<miner_id>:              <miner_id> to use as pool pass login (will be taken from the first miner otherwise)
        --perf_<algo_class>=<hashrate>  Sets hashrate for perf <algo_class> that is: cn, cn-fast, cn-lite, cn-heavy
        --miner=<command_line> (-m):    <command_line> to start smart miner that can report algo itself
        --<algo>=<command_line>:        <command_line> to start miner for <algo> that can not report it itself
        --quiet (-q):                   do not show miner output during configuration and also less messages
        --debug:                        show pool and miner messages
        --log=<file_name>:              <file_name> of output log
        --no-config-save:               Do not save config file
        --help (-help,-h,-?):           Prints this help text
```

# Usage example with xmrig on Ubuntu 16.04

* Get xmrig:

```shell
wget https://github.com/xmrig/xmrig/releases/download/v2.6.4/xmrig-2.6.4-xenial-amd64.tar.gz
tar xf xmrig-2.6.4-xenial-amd64.tar.gz
cd xmrig-2.6.4/
```

* Get node and Meta Miner (mm.js):

```shell
sudo apt-get update
sudo apt-get install -y nodejs-legacy
wget https://raw.githubusercontent.com/MoneroOcean/meta-miner/master/mm.js
chmod +x mm.js
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

# Usage example with xmr-stak on Ubuntu 16.04

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

* Enable hashrate output so it can be collected by mm.js:

```shell
sed -i 's/"verbose_level" : 3,/"verbose_level" : 4,/' config.txt
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

# Usage example with xmrig-amd on Windows

* Install nodejs from https://nodejs.org/dist/v8.11.3/node-v8.11.3-x64.msi

* Unpack the lastest xmrig-amd (https://github.com/xmrig/xmrig-amd/releases/download/v2.7.3-beta/xmrig-amd-2.7.3-beta-win64.zip)

* Download and place https://raw.githubusercontent.com/MoneroOcean/meta-miner/master/mm.js into unpacked xmrig-amd directory

* Modify config.json file in xmrig-amd directory this way and adjust it for the best threads performance:

	* Set "url" to "localhost:3333"
	* Set "user" to "44qJYxdbuqSKarYnDSXB6KLbsH4yR65vpJe3ELLDii9i4ZgKpgQXZYR4AMJxBJbfbKZGWUxZU42QyZSsP4AyZZMbJBCrWr1" (put your Monero address)

* Copy config.jon to config-lite.json, put "algo" to "cryptonight-lite/1" in config-lite.json and adjust it for the best threads performance

* Copy config.json to config-heavy.json, put "algo" to "cryptonight-heavy/0" in config-heavy.json and adjust it for the best threads performance

* Run Meta Miner:

```shell
node mm.js -p=gulf.moneroocean.stream:10001 -m="xmrig-amd.exe --config=config.json" -m="xmrig-amd.exe --config=config-heavy.json" -m="xmrig-amd.exe --config=config-lite.json"
```
