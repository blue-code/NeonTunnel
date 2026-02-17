# NeonTunnel (네온 터널) 🚇 v2.0

**나만의 ngrok, 나만의 터널링 서버**  
TCP 포트 포워딩뿐만 아니라 **커스텀 서브도메인(HTTP/HTTPS)**까지 지원하는 강력한 터널링 솔루션입니다.

---

## ✨ 특징 (Features)
- **TCP 터널링:** 임의의 포트 또는 지정된 포트로 연결 (DB, SSH 등).
- **HTTP/HTTPS 터널링:** `myapp.domain.com` 같은 깔끔한 서브도메인 주소 제공.
- **SSL 지원:** 릴레이 서버에 인증서만 있으면 자동으로 HTTPS 적용.
- **다중 터널:** 하나의 서버에서 수십 개의 터널 동시 운영 가능.

---

## 🛠️ 설치 및 실행 방법

### 1️⃣ Relay Server (중계 서버)
*공인 IP가 있는 서버에서 실행하세요.*

```bash
# 1. 설치
git clone https://github.com/blue-code/NeonTunnel.git
cd NeonTunnel/relay-server
npm install

# 2. (옵션) SSL 인증서 설정 (환경변수)
# export SSL_KEY=/path/to/privkey.pem
# export SSL_CERT=/path/to/fullchain.pem
# export DOMAIN=my-relay.com

# 3. 실행
npm start
```

### 2️⃣ Client CLI (로컬 터널 생성)
*내 PC에서 실행하세요.*

```bash
# 1. 설치
cd NeonTunnel/client-cli
npm install
npm link

# 2. 사용법 (기본 TCP)
neon-tunnel -p 8080 -s http://my-relay.com:3000

# 3. 사용법 (HTTP 서브도메인)
# 결과: https://myapp.my-relay.com
neon-tunnel -p 3000 --subdomain myapp
```

---

## 📝 명령어 옵션
| 옵션 | 설명 | 예시 |
| :--- | :--- | :--- |
| `-p, --port` | 로컬 포트 (필수) | `-p 8080` |
| `-s, --server` | 릴레이 서버 주소 | `-s http://my-relay.com:3000` |
| `-r, --remote-port` | 공인 포트 지정 (TCP 모드) | `-r 33344` |
| `-d, --subdomain` | 서브도메인 지정 (HTTP 모드) | `-d myapp` |
| `-l, --local-host` | 로컬 바인딩 주소 | `-l 0.0.0.0` |

---

## 📝 라이선스
MIT License - **Created for BH 💕 by Tiffany**
