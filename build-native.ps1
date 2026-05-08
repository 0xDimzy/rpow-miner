$cc = "gcc"

gcc -O3 -march=native -pthread `
    rpow-native-miner.c `
    -o rpow-native-miner.exe

Write-Host "Built rpow-native-miner.exe"
