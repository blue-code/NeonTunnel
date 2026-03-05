# NeonTunnel (네온 터널) 🚇 v2.1

**나만의 ngrok, 나만의 터널링 서버**  
외부에서 접속할 수 없는 로컬 서버(localhost)를 공인 IP를 가진 중계 서버(Relay)를 통해 전 세계 어디서나 접속할 수 있게 해주는 오픈소스 터널링 솔루션입니다.

---

## ✨ 특징 (Key Features)

### 1. 🌐 HTTP/HTTPS 서브도메인 지원
- `http://myapp.vooai.duckdns.org` 처럼 깔끔한 주소로 로컬 서버를 공유할 수 있습니다.
- 복잡한 포트 번호 대신 기억하기 쉬운 이름을 사용하세요.

### 2. 🔌 TCP 포트 포워딩
- 웹 서버뿐만 아니라 SSH(22), DB(3306), RDP(3389) 등 **모든 TCP 트래픽**을 터널링할 수 있습니다.
- 예: `neon-tunnel -p 22 -r 33344` → 외부에서 `ssh user@relay-server -p 33344`로 접속 가능.

### 3. 🖥️ 웹 대시보드 (Web Dashboard)
- `http://relay-server:3000/admin` 에서 현재 연결된 모든 터널 목록을 실시간으로 모니터링하고 제어(Kill)할 수 있습니다.

### 4. 🔒 보안 및 안정성
- **Greenlock** 기반의 자동 SSL 인증서 발급 지원 (HTTPS). (현재 안정성을 위해 HTTP 모드 권장)
- **PM2** 연동으로 서버 재부팅 시 자동 실행 및 무중단 운영 가능.

---

## 🛠️ 설치 및 실행 (Installation)

### 1️⃣ Relay Server (중계 서버) 구축
*AWS, Oracle Cloud, VPS 등 **공인 IP**가 있는 서버에 설치하세요.*

```bash
# 1. 프로젝트 클론
git clone https://github.com/blue-code/NeonTunnel.git
cd NeonTunnel/relay-server

# 2. 의존성 설치
npm install

# 3. 포트 방화벽 해제 (Linux)
# 80(HTTP), 3000(Admin), 33000-39000(TCP Tunnel)
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --permanent --add-port=33000-39000/tcp
sudo firewall-cmd --reload

# 4. (중요) Node.js 권한 부여 (80번 포트 사용 시)
sudo setcap cap_net_bind_service=+ep $(readlink -f $(which node))

# 5. 서버 실행 (PM2 권장)
sudo npm install -g pm2
pm2 start index.js --name "relay"
pm2 save
pm2 startup
```

### 2️⃣ Client CLI (로컬 터널 생성)
*외부에 공개하고 싶은 로컬 서버가 있는 PC(Mac/Windows)에서 실행하세요.*

```bash
# 1. 프로젝트 클론 및 설치
git clone https://github.com/blue-code/NeonTunnel.git
cd NeonTunnel/client-cli
npm install
npm link  # 전역 명령어 등록 (선택)

# 2. 사용법 (기본)
# 로컬 8080 포트를 'myapp' 서브도메인으로 연결
neon-tunnel -p 8080 --subdomain myapp --server http://내-서버-주소:3000

# 3. 사용법 (TCP 포트 지정)
# 로컬 22 포트를 공인 33344 포트로 연결
neon-tunnel -p 22 -r 33344 --server http://내-서버-주소:3000

# 4. 사용법 (로컬 주소 바인딩 - Mac/Docker 등)
# localhost 대신 0.0.0.0 으로 연결해야 할 때
neon-tunnel -p 8000 -l 0.0.0.0 --subdomain dash --server http://내-서버-주소:3000
```

---

## 📝 명령어 옵션 (Options)

| 옵션 | 단축 | 설명 | 예시 |
| :--- | :--- | :--- | :--- |
| `--port` | `-p` | 로컬 서버의 포트 번호 (필수) | `-p 3000` |
| `--server` | `-s` | Relay 서버 주소 (필수) | `-s http://voogi.duckdns.org:3000` |
| `--subdomain` | `-d` | HTTP 터널용 서브도메인 이름 | `-d myapp` |
| `--remote-port` | `-r` | TCP 터널용 공인 포트 번호 (33000~39000) | `-r 33344` |
| `--local-host` | `-l` | 로컬 바인딩 주소 (기본: 127.0.0.1) | `-l 0.0.0.0` |

---

## 🐞 문제 해결 (Troubleshooting)

- **Q. 접속이 안 돼요!**
    - 서버 방화벽(AWS Security Group, Oracle Ingress Rule)에서 해당 포트(80, 3000, 33xxx)가 열려있는지 확인하세요.
    - DuckDNS 도메인이 서버 IP와 정확히 연결되어 있는지 확인하세요. (`ping myapp.voogi.duckdns.org`)

- **Q. Mac에서 연결이 안 돼요!**
    - 로컬 서버가 IPv6(`::1`)로 떠있을 수 있습니다. `-l 127.0.0.1` 또는 `-l 0.0.0.0` 옵션을 추가해보세요.

---

## 📜 라이선스
MIT License - **Created for BH 💕 by Tiffany**
