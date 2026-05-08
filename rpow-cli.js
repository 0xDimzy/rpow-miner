#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

//
// ==========================================
// CONFIG
// ==========================================
//

const DEFAULT_SITE_ORIGIN =
  "https://rpow3.com";

const DEFAULT_API_ORIGIN =
  "https://api.rpow3.com";

const DEFAULT_STATE = path.join(
  __dirname,
  ".rpow3-cli-state.json"
);

const NATIVE_MINER_CANDIDATES =
  process.platform === "win32"
    ? [
        path.join(
          __dirname,
          "rpow-native-miner.exe"
        ),
        path.join(
          __dirname,
          "rpow-native-miner"
        ),
      ]
    : [
        path.join(
          __dirname,
          "rpow-native-miner"
        ),
        path.join(
          __dirname,
          "rpow-native-miner.exe"
        ),
      ];

//
// ==========================================
// COLORS
// ==========================================
//

const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

//
// ==========================================
// HELPERS
// ==========================================
//

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}

function line() {
  console.log(
    COLORS.cyan +
      "════════════════════════════════════════════════════" +
      COLORS.reset
  );
}

function banner(workers, target) {
  console.clear();

  line();

  console.log(
    COLORS.green +
      "              RPOW3 NATIVE MINER" +
      COLORS.reset
  );

  line();

  console.log(
    `Site      : ${DEFAULT_SITE_ORIGIN}`
  );

  console.log(
    `API       : ${DEFAULT_API_ORIGIN}`
  );

  console.log(
    `Workers   : ${workers}`
  );

  console.log(
    `Target    : ${target}`
  );

  console.log(
    `Engine    : native`
  );

  line();
}

function shortHash(hash) {
  if (!hash) return "-";

  return (
    hash.slice(0, 12) +
    "..." +
    hash.slice(-6)
  );
}

function parseArgs(argv) {
  const out = { _: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }

    const key = arg.slice(2);

    const next = argv[i + 1];

    if (
      next &&
      !next.startsWith("--")
    ) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }

  return out;
}

function log(level, message, data) {
  const suffix =
    data === undefined
      ? ""
      : ` ${JSON.stringify(data)}`;

  const upper =
    level.toUpperCase();

  const color =
    upper === "SUCCESS"
      ? COLORS.green
      : upper === "WARN"
      ? COLORS.yellow
      : upper === "ERROR"
      ? COLORS.red
      : COLORS.cyan;

  console.log(
    `${new Date().toISOString()} ` +
      `${color}${upper}${COLORS.reset} ` +
      `${message}${suffix}`
  );
}

function loadState(file) {
  try {
    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
  } catch {
    return {};
  }
}

function saveState(file, state) {
  fs.writeFileSync(
    file,
    JSON.stringify(state, null, 2)
  );
}

function cookieHeader(cookies = {}) {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function storeSetCookies(
  state,
  headers
) {
  const raw =
    headers.getSetCookie?.() ||
    [
      headers.get("set-cookie"),
    ].filter(Boolean);

  if (!raw.length) return;

  state.cookies ||= {};

  for (const item of raw) {
    const first =
      item.split(";")[0];

    const eq =
      first.indexOf("=");

    if (eq <= 0) continue;

    const key =
      first.slice(0, eq);

    const val =
      first.slice(eq + 1);

    state.cookies[key] =
      val;
  }
}

function defaultWorkerCount() {
  return Math.max(
    1,
    Math.min(
      os.cpus().length,
      8
    )
  );
}

function nativeMinerPath() {
  return NATIVE_MINER_CANDIDATES.find(
    (f) => fs.existsSync(f)
  );
}

//
// ==========================================
// CLIENT
// ==========================================
//

class RpowClient {
  constructor(options) {
    this.apiOrigin =
      options.apiOrigin;

    this.siteOrigin =
      options.siteOrigin;

    this.stateFile =
      options.stateFile;

    this.state = loadState(
      this.stateFile
    );
  }

  save() {
    saveState(
      this.stateFile,
      this.state
    );
  }

  async request(
    method,
    pathName,
    body,
    options = {}
  ) {
    const url = new URL(
      pathName,
      this.apiOrigin
    );

    const headers = {
      accept:
        "application/json, text/plain, */*",

      origin: this.siteOrigin,

      referer: `${this.siteOrigin}/`,

      "user-agent":
        "rpow3-cli/1.0",
    };

    const cookies =
      cookieHeader(
        this.state.cookies
      );

    if (cookies) {
      headers.cookie =
        cookies;
    }

    let payload;

    if (body !== undefined) {
      headers[
        "content-type"
      ] = "application/json";

      payload = JSON.stringify(
        body
      );
    }

    const controller =
      new AbortController();

    const timeout =
      setTimeout(() => {
        controller.abort();
      }, 30000);

    try {
      const res = await fetch(
        url,
        {
          method,
          headers,
          body: payload,
          redirect:
            options.redirect ||
            "manual",
          signal:
            controller.signal,
        }
      );

      storeSetCookies(
        this.state,
        res.headers
      );

      this.save();

      const text =
        await res.text();

      let parsed;

      try {
        parsed = JSON.parse(
          text
        );
      } catch {
        parsed = text;
      }

      if (
        !res.ok &&
        ![
          301,
          302,
          303,
          307,
          308,
        ].includes(res.status)
      ) {
        const err = new Error(
          parsed?.message ||
            text ||
            `HTTP ${res.status}`
        );

        err.status =
          res.status;

        throw err;
      }

      return {
        res,
        data: parsed,
      };

    } finally {
      clearTimeout(timeout);
    }
  }

  async api(
    method,
    pathName,
    body,
    options
  ) {
    return (
      await this.request(
        method,
        pathName,
        body,
        options
      )
    ).data;
  }

  async followMagicLink(
    link
  ) {
    let url = link;

    for (
      let i = 0;
      i < 8;
      i++
    ) {
      const { res } =
        await this.request(
          "GET",
          url,
          undefined,
          {
            redirect:
              "manual",
          }
        );

      const location =
        res.headers.get(
          "location"
        );

      log(
        "info",
        "redirect",
        {
          status:
            res.status,
          location,
        }
      );

      if (
        ![
          301,
          302,
          303,
          307,
          308,
        ].includes(
          res.status
        ) ||
        !location
      ) {
        return;
      }

      url = location;
    }

    throw new Error(
      "too many redirects"
    );
  }
}

//
// ==========================================
// NATIVE MINER
// ==========================================
//

function mineSolutionNative(
  challenge,
  workerCount,
  logEveryMs
) {
  const nativeMiner =
    nativeMinerPath();

  if (!nativeMiner) {
    throw new Error(
      "native miner not built"
    );
  }

  return new Promise(
    (resolve, reject) => {
      const child = spawn(
        nativeMiner,
        [
          "--prefix",
          challenge.nonce_prefix,

          "--difficulty",
          String(
            challenge.difficulty_bits
          ),

          "--workers",
          String(
            workerCount
          ),

          "--progress-ms",
          String(
            logEveryMs
          ),
        ]
      );

      let buffer = "";

      child.stdout.on(
        "data",
        (chunk) => {
          buffer +=
            chunk.toString();

          while (
            buffer.includes(
              "\n"
            )
          ) {
            const idx =
              buffer.indexOf(
                "\n"
              );

            const line =
              buffer
                .slice(
                  0,
                  idx
                )
                .trim();

            buffer =
              buffer.slice(
                idx + 1
              );

            if (!line)
              continue;

            let msg;

            try {
              msg =
                JSON.parse(
                  line
                );
            } catch {
              continue;
            }

            if (
              msg.type ===
              "found"
            ) {
              resolve({
                solution_nonce:
                  msg.solution_nonce,

                hashes:
                  msg.hashes,

                digest:
                  msg.digest,
              });
            }
          }
        }
      );

      child.stderr.on(
        "data",
        (d) => {
          process.stderr.write(
            d
          );
        }
      );

      child.on(
        "error",
        reject
      );
    }
  );
}

//
// ==========================================
// PROMPT
// ==========================================
//

async function promptLine(
  label
) {
  const rl =
    readline.createInterface(
      {
        input:
          process.stdin,

        output:
          process.stdout,
      }
    );

  return new Promise(
    (resolve) =>
      rl.question(
        label,
        (
          answer
        ) => {
          rl.close();

          resolve(
            answer.trim()
          );
        }
      )
  );
}

//
// ==========================================
// MAIN
// ==========================================
//

async function main() {
  const args = parseArgs(
    process.argv.slice(2)
  );

  const command =
    args._[0] || "help";

  const client =
    new RpowClient({
      apiOrigin:
        DEFAULT_API_ORIGIN,

      siteOrigin:
        DEFAULT_SITE_ORIGIN,

      stateFile:
        DEFAULT_STATE,
    });

  //
  // LOGIN
  //

  if (
    command === "login"
  ) {
    const email =
      args.email ||
      (await promptLine(
        "email: "
      ));

    await client.api(
      "POST",
      "/auth/request",
      {
        email,
      }
    );

    client.state.email =
      email;

    client.save();

    log(
      "success",
      "magic link requested"
    );

    return;
  }

  //
  // COMPLETE LOGIN
  //

  if (
    command ===
    "complete-login"
  ) {
    const link =
      args.link ||
      (await promptLine(
        "magic link: "
      ));

    await client.followMagicLink(
      link
    );

    const me =
      await client.api(
        "GET",
        "/me"
      );

    log(
      "success",
      "session active",
      me
    );

    return;
  }

  //
  // MINE
  //

  if (
    command ===
      "mine" ||
    command === "run"
  ) {
    const target =
      Number(
        args.count || 1
      );

    const workers =
      Number(
        args.workers ||
          defaultWorkerCount()
      );

    const logEveryMs =
      Number(
        args[
          "log-every-ms"
        ] || 1000
      );

    let minted = 0;

    banner(
      workers,
      target
    );

    //
    // LOGIN CHECK
    //

    let me;

    while (true) {
      try {

        me =
          await client.api(
            "GET",
            "/me"
          );

        break;

      } catch (err) {

        log(
          "warn",
          "login check failed retrying",
          {
            error:
              err.message,
            status:
              err.status,
          }
        );

        await sleep(5000);
      }
    }

    console.log(
      COLORS.green +
        `Logged in : ${
          me.email ||
          "unknown"
        }` +
        COLORS.reset
    );

    console.log(
      COLORS.yellow +
        `Balance   : ${
          me.balance || 0
        }` +
        COLORS.reset
    );

    line();

    //
    // MAIN LOOP
    //

    while (
      minted < target
    ) {

      //
      // GET CHALLENGE
      //

      let challenge;

      while (true) {
        try {

          challenge =
            await client.api(
              "POST",
              "/challenge"
            );

          break;

        } catch (err) {

          log(
            "warn",
            "challenge failed retrying",
            {
              error:
                err.message,
              status:
                err.status,
            }
          );

          await sleep(5000);
        }
      }

      console.log(
        COLORS.cyan +
          `Challenge : ${challenge.challenge_id}` +
          COLORS.reset
      );

      console.log(
        COLORS.cyan +
          `Difficulty: ${challenge.difficulty_bits} bits` +
          COLORS.reset
      );

      //
      // MINE
      //

      const startedAt =
        Date.now();

      let solution;

      while (true) {
        try {

          solution =
            await mineSolutionNative(
              challenge,
              workers,
              logEveryMs
            );

          break;

        } catch (err) {

          log(
            "warn",
            "miner failed retrying",
            {
              error:
                err.message,
            }
          );

          await sleep(3000);
        }
      }

      const elapsed = (
        (Date.now() -
          startedAt) /
        1000
      ).toFixed(2);

      console.log(
        COLORS.green +
          "\n✓ SOLUTION FOUND" +
          COLORS.reset
      );

      console.log(
        `Nonce     : ${solution.solution_nonce}`
      );

      console.log(
        `Hash      : ${shortHash(solution.digest)}`
      );

      console.log(
        `Time      : ${elapsed}s`
      );

      //
      // MINT
      //

      while (true) {
        try {

          await client.api(
            "POST",
            "/mint",
            {
              challenge_id:
                challenge.challenge_id,

              solution_nonce:
                solution.solution_nonce,
            }
          );

          minted++;

          console.log(
            COLORS.green +
              "✓ Mint success" +
              COLORS.reset
          );

          //
          // REFRESH BALANCE
          //

          try {

            me =
              await client.api(
                "GET",
                "/me"
              );

            console.log(
              COLORS.yellow +
                `Updated Balance : ${me.balance}` +
                COLORS.reset
            );

          } catch {

            console.log(
              "Balance refresh failed"
            );
          }

          console.log(
            COLORS.magenta +
              `Minted    : ${minted}` +
              COLORS.reset
          );

          line();

          break;

        } catch (err) {

          log(
            "warn",
            "mint failed retrying",
            {
              error:
                err.message,
              status:
                err.status,
            }
          );

          if (
            String(
              err.message
            )
              .toLowerCase()
              .includes(
                "expired"
              )
          ) {

            log(
              "warn",
              "challenge expired requesting new one"
            );

            break;
          }

          if (
            err.status ===
            401
          ) {

            log(
              "error",
              "session expired login again"
            );

            process.exit(1);
          }

          await sleep(5000);
        }
      }

      await sleep(1000);
    }

    log(
      "success",
      "done",
      {
        minted,
      }
    );

    return;
  }

  //
  // HELP
  //

  console.log(`
Usage:

node rpow-cli.js login --email you@example.com

node rpow-cli.js complete-login --link "https://..."

node rpow-cli.js mine --count 999999999 --workers $(nproc)
`);
}

main().catch(
  (err) => {
    log(
      "error",
      err.message,
      {
        status:
          err.status,
      }
    );

    process.exitCode = 1;
  }
);
