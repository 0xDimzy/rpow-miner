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
  "https://rpow2.com";

const DEFAULT_API_ORIGIN =
  "https://api.rpow2.com";

const DEFAULT_STATE = path.join(
  __dirname,
  ".rpow2-cli-state.json"
);

const BASE_UNITS =
  1000000;

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
      "              RPOW2 NATIVE MINER" +
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

function formatBalance(baseUnits) {
  return (
    Number(baseUnits || 0) /
    BASE_UNITS
  ).toFixed(6);
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

//
// ==========================================
// STATE
// ==========================================
//

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
        "rpow2-cli/1.0",
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

    const res = await fetch(
      url,
      {
        method,
        headers,
        body: payload,
        redirect:
          options.redirect ||
          "manual",
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
  workerCount
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

    console.log(
      COLORS.green +
        "✓ Magic link sent" +
        COLORS.reset
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

    let success = false;

    for (
      let attempt = 1;
      attempt <= 5;
      attempt++
    ) {

      try {

        console.log(
          COLORS.yellow +
            `Attempt ${attempt}/5` +
            COLORS.reset
        );

        await client.followMagicLink(
          link
        );

        const me =
          await client.api(
            "GET",
            "/me"
          );

        console.log(
          COLORS.green +
            "✓ Login success" +
            COLORS.reset
        );

        console.log(
          `Email   : ${me.email}`
        );

        console.log(
          `Balance : ${formatBalance(me.balance_base_units)}`
        );

        success = true;

        break;

      } catch (err) {

        console.log(
          COLORS.red +
            `Attempt ${attempt} failed` +
            COLORS.reset
        );

        console.log(
          err.message
        );

        await sleep(5000);
      }
    }

    if (!success) {
      process.exit(1);
    }

    return;
  }

  //
  // MINE
  //

  if (
    command === "mine"
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

    let minted = 0;

    banner(
      workers,
      target
    );

    let me;

    while (true) {

      try {

        me =
          await client.api(
            "GET",
            "/me"
          );

        break;

      } catch {

        console.log(
          COLORS.red +
            "Session invalid retrying..." +
            COLORS.reset
        );

        await sleep(5000);
      }
    }

    console.log(
      COLORS.green +
        `Logged in : ${me.email}` +
        COLORS.reset
    );

    console.log(
      COLORS.yellow +
        `Balance   : ${formatBalance(me.balance_base_units)} RPOW` +
        COLORS.reset
    );

    console.log(
      COLORS.magenta +
        `Daily Left: ${formatBalance(me.daily_remaining_base_units)} RPOW` +
        COLORS.reset
    );

    line();

    while (
      minted < target
    ) {

      let challenge;

      while (true) {

        try {

          challenge =
            await client.api(
              "POST",
              "/challenge"
            );

          break;

        } catch {

          console.log(
            COLORS.red +
              "Challenge retrying..." +
              COLORS.reset
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
          `Difficulty: ${challenge.difficulty_bits}` +
          COLORS.reset
      );

      const startedAt =
        Date.now();

      let solution;

      while (true) {

        try {

          solution =
            await mineSolutionNative(
              challenge,
              workers
            );

          break;

        } catch {

          console.log(
            COLORS.red +
              "Miner retrying..." +
              COLORS.reset
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
        `Nonce : ${solution.solution_nonce}`
      );

      console.log(
        `Hash  : ${shortHash(solution.digest)}`
      );

      console.log(
        `Time  : ${elapsed}s`
      );

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

          try {

            me =
              await client.api(
                "GET",
                "/me"
              );

            console.log(
              COLORS.yellow +
                `Updated Balance : ${formatBalance(me.balance_base_units)} RPOW` +
                COLORS.reset
            );

            console.log(
              COLORS.magenta +
                `Daily Remaining : ${formatBalance(me.daily_remaining_base_units)} RPOW` +
                COLORS.reset
            );

          } catch {

            console.log(
              COLORS.red +
                "Balance refresh failed" +
                COLORS.reset
            );
          }

          console.log(
            COLORS.cyan +
              `Minted : ${minted}` +
              COLORS.reset
          );

          line();

          break;

        } catch {

          console.log(
            COLORS.red +
              "Mint retrying..." +
              COLORS.reset
          );

          await sleep(5000);
        }
      }

      await sleep(1000);
    }
  }
}

main().catch(
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
