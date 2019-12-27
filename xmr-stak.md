### Usage example with xmr-stak (AMD only) on Windows

* Download and unpack the lastest xmr-stak (https://github.com/fireice-uk/xmr-stak/releases/download/2.10.8/xmr-stak-linux-2.10.8-cpu_opencl-amd.tar.xz).

* Configure xmr-stak this way (put your Monero wallet address):

```
- Please enter the currency that you want to mine:
  ...
cryptonight_r
- Pool address: e.g. pool.example.com:3333
localhost:3333
- Username (wallet address or pool login):
44qJYxdbuqSKarYnDSXB6KLbsH4yR65vpJe3ELLDii9i4ZgKpgQXZYR4AMJxBJbfbKZGWUxZU42QyZSsP4AyZZMbJBCrWr1
```

* Enable faster hashrate output by setting "h_print_time" to 60 in config.txt.

* Copy amd.txt to amd-heavy.txt, amd-gpu.txt and amd-pico.txt and adjust all of them for the best threads performance (out of scope of this guide).

* Run Meta Miner (or use "node mm.js" instead of mm.exe):

```shell
mm.exe -p=gulf.moneroocean.stream:10001 --cn/r="xmr-stak.exe --noCPU --currency cryptonight_r --amd amd.txt" --cn/half="xmr-stak.exe --noCPU --currency cryptonight_v8_half --amd amd.txt" --cn-heavy/xhv="xmr-stak.exe --noCPU --currency cryptonight_haven --amd amd-heavy.txt" --cn-heavy/tube="xmr-stak.exe --noCPU --currency cryptonight_bittube2 --amd amd-heavy.txt" --cn/gpu="xmr-stak.exe --noCPU --currency cryptonight_gpu --amd amd-gpu.txt" --cn-pico/trtl="xmr-stak.exe --noCPU --currency cryptonight_turtle --amd amd-pico.txt"
```
* To run Meta Miner for xmr-stak CPU/GPU use this command (need to create cpu-*.txt configs for CPU in this case as well based on cpu.txt with adjusted thread configuration):

```shell
mm.exe -p=gulf.moneroocean.stream:10001 --cn/r="xmr-stak.exe --currency cryptonight_r --amd amd.txt --cpu cpu.txt" --cn/half="xmr-stak.exe --currency cryptonight_v8_half --amd amd.txt --cpu cpu.txt" --cn-heavy/xhv="xmr-stak.exe --currency cryptonight_haven --amd amd-heavy.txt --cpu cpu-heavy.txt" --cn-heavy/tube="xmr-stak.exe --currency cryptonight_bittube2 --amd amd-heavy.txt --cpu cpu-heavy.txt" --cn/gpu="xmr-stak.exe --currency cryptonight_gpu --amd amd-gpu.txt" --cn-pico/trtl="xmr-stak.exe --currency cryptonight_turtle --amd amd-pico.txt --cpu cpu-pico.txt"
```

### Usage example with xmr-stak-rx (CPU only) on Linux

* Get xmr-stak-rx:

```shell
wget https://github.com/fireice-uk/xmr-stak/releases/download/1.0.3-rx/xmr-stak-rx-linux-1.0.3-cpu.tar.xz
tar xf xmr-stak-rx-linux-1.0.3-cpu.tar.xz
cd xmr-stak-rx-linux-1.0.3-cpu
```

* Configure xmr-stak-rx this way (put your Monero wallet address):

```shell
./xmr-stak-rx
```
```
Use simple setup method? (Y/n)
Y

Configuration stored in file 'config.txt'
Please enter:
- Please enter the currency that you want to mine:
        - arqma
        - loki
        - monero
        - randomx
        - randomx_arqma
        - randomx_loki
        - randomx_wow
        - wownero
randomx

- Pool address: e.g. pool.example.com:3333
localhost:3333
- Username (wallet address or pool login):
44qJYxdbuqSKarYnDSXB6KLbsH4yR65vpJe3ELLDii9i4ZgKpgQXZYR4AMJxBJbfbKZGWUxZU42QyZSsP4AyZZMbJBCrWr1
- Password (mostly empty or x):

- Does this pool port support TLS/SSL? Use no if unknown. (y/N)
N
```

* Enable faster hashrate report:

```shell
sed -i 's/"h_print_time" : .\+,/"h_print_time" : 60,/' config.txt
```

* Prepare and adjust configs for different algorithms:

```shell
cp cpu.txt cpu-wow.txt
cp cpu.txt cpu-arq.txt
```

* Run Meta Miner:

```shell
./mm.js -p=gulf.moneroocean.stream:10001 --rx/0="./xmr-stak-rx --currency randomx --cpu cpu.txt --noTest" --rx/loki="./xmr-stak-rx --currency randomx_loki --cpu cpu.txt --noTest" --rx/arq="./xmr-stak-rx --currency randomx_arqma --cpu cpu-arq.txt --noTest" --rx/wow="./xmr-stak-rx --currency randomx_wow --cpu cpu-wow.txt --noTest"
```