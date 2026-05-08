import os
import json
import time
import queue
import random
import hashlib
import threading
import urllib3
import ssl

from concurrent.futures import ThreadPoolExecutor
import requests
from colorama import Fore, init
from requests.adapters import HTTPAdapter
from urllib3.poolmanager import PoolManager

urllib3.disable_warnings()
init(autoreset=True)

# ==========================================
# CONFIG
# ==========================================

SITE_URL = "https://rpow3.com"
BASE_URL = "https://api.rpow3.com"

THREADS = os.cpu_count() or 8

os.makedirs("sessions", exist_ok=True)


# ==========================================
# LOAD FILES
# ==========================================

def load_lines(path):
    if not os.path.exists(path):
        return []

    with open(path, "r", encoding="utf-8") as f:
        return [x.strip() for x in f if x.strip()]


ACCOUNTS = load_lines("accounts.txt")
PROXIES = load_lines("proxies.txt")


# ==========================================
# TLS FIX
# ==========================================

class TLSAdapter(HTTPAdapter):
    def init_poolmanager(
        self,
        connections,
        maxsize,
        block=False,
        **pool_kwargs
    ):
        ctx = ssl.create_default_context()

        ctx.set_ciphers(
            "DEFAULT@SECLEVEL=1"
        )

        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        self.poolmanager = PoolManager(
            num_pools=connections,
            maxsize=maxsize,
            block=block,
            ssl_context=ctx
        )


# ==========================================
# SESSION
# ==========================================

def session_path(email):
    safe = email.replace("@", "_").replace(".", "_")
    return f"sessions/{safe}.json"


def save_cookies(session, email):
    data = requests.utils.dict_from_cookiejar(
        session.cookies
    )

    with open(session_path(email), "w") as f:
        json.dump(data, f)


def load_cookies(session, email):
    path = session_path(email)

    if not os.path.exists(path):
        return False

    try:
        with open(path, "r") as f:
            data = json.load(f)

        session.cookies = requests.utils.cookiejar_from_dict(data)

        return True

    except:
        return False


# ==========================================
# PROXY
# ==========================================

def random_proxy():
    if not PROXIES:
        return None

    proxy = random.choice(PROXIES)

    return {
        "http": proxy,
        "https": proxy
    }


# ==========================================
# USER AGENT
# ==========================================

USER_AGENTS = [
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/147.0.0.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
]


# ==========================================
# CLIENT
# ==========================================

def build_client(proxy=None):
    session = requests.Session()

    session.mount(
        "https://",
        TLSAdapter()
    )

    session.headers.update({
        "accept": "application/json, text/plain, */*",
        "origin": SITE_URL,
        "referer": f"{SITE_URL}/",
        "user-agent": random.choice(USER_AGENTS)
    })

    session.verify = False

    if proxy:
        session.proxies.update(proxy)

    return session


# ==========================================
# CHECK LOGIN
# ==========================================

def check_login(session):
    try:
        r = session.get(
            f"{BASE_URL}/me",
            timeout=30
        )

        print(
            Fore.CYAN +
            f"[CHECK LOGIN] Status: {r.status_code}"
        )

        if r.status_code == 200:
            return r.json()

    except Exception as e:
        print(
            Fore.RED +
            f"[CHECK LOGIN] Error: {e}"
        )

    return None


# ==========================================
# REQUEST EMAIL
# ==========================================

def request_magic(email, session):
    payload = {
        "email": email
    }

    for attempt in range(5):
        try:
            r = session.post(
                f"{BASE_URL}/auth/request",
                json=payload,
                timeout=60
            )

            print(
                Fore.YELLOW +
                f"\n[{email}] Status: {r.status_code}"
            )

            print(r.text)

            if r.status_code == 200:
                return True

        except Exception as e:
            print(
                Fore.RED +
                f"[{email}] Retry {attempt+1}: {e}"
            )

        time.sleep(random.uniform(3, 7))

    return False


# ==========================================
# VERIFY TOKEN
# ==========================================

def verify_token(session, token_input):
    try:
        if "token=" in token_input:
            token = token_input.split("token=")[1]
        else:
            token = token_input

        url = f"{BASE_URL}/auth/verify?token={token}"

        print(
            Fore.YELLOW +
            f"\nVerifying: {url}"
        )

        r = session.get(
            url,
            allow_redirects=True,
            timeout=60
        )

        print(
            Fore.CYAN +
            f"Verify Status: {r.status_code}"
        )

        if r.status_code != 200:
            print(Fore.RED + f"Response: {r.text}")

        print(
            Fore.CYAN +
            f"Final URL: {r.url}"
        )

        print(
            Fore.CYAN +
            f"Cookies: {session.cookies.get_dict()}"
        )

        return r.status_code == 200

    except Exception as e:
        print(
            Fore.RED +
            f"Verify error: {e}"
        )

        return False


# ==========================================
# GET CHALLENGE
# ==========================================

def get_challenge(session):
    try:
        print(
            Fore.YELLOW +
            "\nRequesting challenge..."
        )

        print(
            Fore.CYAN +
            f"Current Cookies: {session.cookies.get_dict()}"
        )

        r = session.post(
            f"{BASE_URL}/challenge",
            timeout=60
        )

        print(
            Fore.CYAN +
            f"Challenge Status: {r.status_code}"
        )

        if r.status_code != 200:
            print(Fore.RED + f"Response: {r.text}")
            return None

        data = r.json()

        print(
            Fore.GREEN +
            f"Challenge ID: {data.get('challenge_id')}"
        )

        return data

    except Exception as e:
        print(
            Fore.RED +
            f"Challenge error: {e}"
        )

        return None


# ==========================================
# VALID HASH
# ==========================================

def valid_hash(hex_hash, bits):
    binary = bin(
        int(hex_hash, 16)
    )[2:].zfill(256)

    return binary.endswith(
        "0" * bits
    )


# ==========================================
# SOLVE POW
# ==========================================

def solve_pow(prefix, bits, stop_event, result_queue):
    nonce = random.randint(
        1,
        999999999
    )

    hashes = 0

    while not stop_event.is_set():
        raw = f"{prefix}{nonce}"

        h = hashlib.sha256(
            raw.encode()
        ).hexdigest()

        hashes += 1

        if valid_hash(h, bits):
            stop_event.set()

            result_queue.put({
                "nonce": nonce,
                "hash": h,
                "hashes": hashes
            })

            return

        nonce += 1


# ==========================================
# MINT
# ==========================================

def mint(session, challenge_id, nonce):
    payload = {
        "challenge_id": challenge_id,
        "solution_nonce": str(nonce)
    }

    try:
        r = session.post(
            f"{BASE_URL}/mint",
            json=payload,
            timeout=60
        )

        print(
            Fore.CYAN +
            f"Mint Status: {r.status_code}"
        )

        print(
            Fore.CYAN +
            f"Mint Response: {r.text}"
        )

        return r

    except Exception as e:
        print(
            Fore.RED +
            f"Mint error: {e}"
        )

        return None


# ==========================================
# MINING LOOP
# ==========================================

def run_account(email, session):
    while True:
        try:
            me = check_login(session)

            if not me:
                print(
                    Fore.RED +
                    f"[{email}] Session expired"
                )

                return

            challenge = get_challenge(session)

            if not challenge:
                print(
                    Fore.RED +
                    f"[{email}] Failed get challenge"
                )

                time.sleep(5)
                continue

            challenge_id = challenge["challenge_id"]
            prefix = challenge["nonce_prefix"]
            bits = challenge["difficulty_bits"]

            print(
                Fore.YELLOW +
                f"\n[{email}] Mining bits={bits}"
            )

            stop_event = threading.Event()
            result_queue = queue.Queue()
            workers = []
            start = time.time()

            for _ in range(THREADS):
                t = threading.Thread(
                    target=solve_pow,
                    args=(
                        prefix,
                        bits,
                        stop_event,
                        result_queue
                    )
                )

                t.daemon = True
                t.start()

                workers.append(t)

            for t in workers:
                t.join()

            result = result_queue.get()

            nonce = result["nonce"]

            elapsed = max(
                time.time() - start,
                1
            )

            rate = int(
                result["hashes"] / elapsed
            )

            print(
                Fore.GREEN +
                f"\n[{email}] SOLVED"
            )

            print(
                Fore.GREEN +
                f"Nonce : {nonce}"
            )

            print(
                Fore.GREEN +
                f"Rate  : {rate:,} H/s"
            )

            mint(
                session,
                challenge_id,
                nonce
            )

            me = check_login(session)

            if me:
                print(
                    Fore.MAGENTA +
                    f"[{email}] Balance: {me.get('balance')}"
                )

            time.sleep(
                random.uniform(1, 3)
            )

        except Exception as e:
            print(
                Fore.RED +
                f"[{email}] ERROR: {e}"
            )

            time.sleep(5)


# ==========================================
# REQUEST COMMAND
# ==========================================

def command_request():
    for email in ACCOUNTS:
        proxy = random_proxy()

        session = build_client(proxy)

        print(
            Fore.CYAN +
            f"\nRequesting magic link: {email}"
        )

        ok = request_magic(
            email,
            session
        )

        if ok:
            print(
                Fore.GREEN +
                f"[{email}] Success request"
            )
        else:
            print(
                Fore.RED +
                f"[{email}] Failed request"
            )

        time.sleep(
            random.uniform(2, 5)
        )


# ==========================================
# LOGIN COMMAND
# ==========================================

def command_login():
    token_input = input(
        "\nPaste verify URL/token: "
    ).strip()

    for email in ACCOUNTS:
        proxy = random_proxy()

        session = build_client(proxy)

        print(
            Fore.CYAN +
            f"\nLogin account: {email}"
        )

        ok = verify_token(
            session,
            token_input
        )

        if ok:
            me = check_login(session)

            if me:
                save_cookies(
                    session,
                    email
                )

                print(
                    Fore.GREEN +
                    f"[{email}] Login success"
                )

                print(
                    Fore.MAGENTA +
                    f"Balance: {me.get('balance')}"
                )

            else:
                print(
                    Fore.RED +
                    f"[{email}] Session invalid"
                )

        else:
            print(
                Fore.RED +
                f"[{email}] Login failed"
            )

        time.sleep(
            random.uniform(2, 5)
        )


# ==========================================
# START MINING
# ==========================================

def command_mine():
    sessions = []

    for email in ACCOUNTS:
        proxy = random_proxy()

        session = build_client(proxy)

        ok = load_cookies(
            session,
            email
        )

        if not ok:
            print(
                Fore.RED +
                f"[{email}] No session"
            )
            continue

        print(
            Fore.CYAN +
            f"\nLoaded Cookies: {session.cookies.get_dict()}"
        )

        me = check_login(session)

        if not me:
            print(
                Fore.RED +
                f"[{email}] Session expired"
            )
            continue

        print(
            Fore.GREEN +
            f"[{email}] Ready mining"
        )

        sessions.append(
            (email, session)
        )

    if not sessions:
        print(
            "\nTidak ada session valid"
        )
        return

    print(
        Fore.CYAN +
        f"\nStart mining {len(sessions)} account(s)"
    )

    with ThreadPoolExecutor(
        max_workers=len(sessions)
    ) as ex:

        for email, session in sessions:
            ex.submit(
                run_account,
                email,
                session
            )


# ==========================================
# MAIN
# ==========================================

def main():
    print(Fore.CYAN + f"""
==================================================
                 RPOW3 MINER DEBUG
==================================================
Site     : {SITE_URL}
API      : {BASE_URL}
Threads  : {THREADS}
==================================================
1. Request Email
2. Login With Token
3. Start Mining
==================================================
""")

    choice = input(
        "Choose: "
    ).strip()

    if choice == "1":
        command_request()

    elif choice == "2":
        command_login()

    elif choice == "3":
        command_mine()

    else:
        print(
            Fore.RED +
            "Invalid choice"
        )


if __name__ == "__main__":
    main()
