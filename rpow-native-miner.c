#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <pthread.h>
#include <openssl/sha.h>

volatile int found = 0;

typedef struct {
    unsigned char prefix[64];
    size_t prefix_len;
    int difficulty;
    uint64_t nonce;
    uint64_t stride;
} worker_t;

int trailing_zero_bits(
    unsigned char *hash
) {
    int bits = 0;

    for (int i = 31; i >= 0; i--) {
        unsigned char b = hash[i];

        if (b == 0) {
            bits += 8;
            continue;
        }

        for (int j = 0; j < 8; j++) {
            if ((b & (1 << j)) == 0)
                bits++;
            else
                return bits;
        }
    }

    return bits;
}

void nonce_le64(
    uint64_t nonce,
    unsigned char *buf
) {
    for (int i = 0; i < 8; i++) {
        buf[i] = nonce & 0xff;
        nonce >>= 8;
    }
}

void *worker(void *arg) {
    worker_t *w = (worker_t *)arg;

    unsigned char data[128];
    unsigned char hash[32];

    memcpy(
        data,
        w->prefix,
        w->prefix_len
    );

    uint64_t nonce = w->nonce;

    while (!found) {
        nonce_le64(
            nonce,
            data + w->prefix_len
        );

        SHA256(
            data,
            w->prefix_len + 8,
            hash
        );

        if (
            trailing_zero_bits(hash) >=
            w->difficulty
        ) {
            found = 1;

            char hex[65];

            for (int i = 0; i < 32; i++) {
                sprintf(
                    hex + (i * 2),
                    "%02x",
                    hash[i]
                );
            }

            printf(
                "{\"type\":\"found\","
                "\"solution_nonce\":\"%llu\","
                "\"digest\":\"%s\"}\n",
                (unsigned long long)nonce,
                hex
            );

            fflush(stdout);

            exit(0);
        }

        nonce += w->stride;
    }

    return NULL;
}

int hex_to_bytes(
    const char *hex,
    unsigned char *out
) {
    int len = strlen(hex);

    for (int i = 0; i < len / 2; i++) {
        sscanf(
            hex + 2 * i,
            "%2hhx",
            &out[i]
        );
    }

    return len / 2;
}

int main(
    int argc,
    char **argv
) {
    char *prefix_hex = NULL;

    int difficulty = 0;

    int workers = 1;

    for (int i = 1; i < argc; i++) {
        if (
            strcmp(argv[i], "--prefix") == 0
        ) {
            prefix_hex = argv[++i];
        } else if (
            strcmp(argv[i], "--difficulty") == 0
        ) {
            difficulty = atoi(argv[++i]);
        } else if (
            strcmp(argv[i], "--workers") == 0
        ) {
            workers = atoi(argv[++i]);
        }
    }

    if (!prefix_hex) {
        fprintf(stderr, "missing prefix\n");
        return 1;
    }

    unsigned char prefix[64];

    int prefix_len = hex_to_bytes(
        prefix_hex,
        prefix
    );

    pthread_t tids[workers];

    worker_t args[workers];

    for (int i = 0; i < workers; i++) {
        args[i].prefix_len =
            prefix_len;

        memcpy(
            args[i].prefix,
            prefix,
            prefix_len
        );

        args[i].difficulty =
            difficulty;

        args[i].nonce = i;

        args[i].stride = workers;

        pthread_create(
            &tids[i],
            NULL,
            worker,
            &args[i]
        );
    }

    for (int i = 0; i < workers; i++) {
        pthread_join(
            tids[i],
            NULL
        );
    }

    return 0;
}
