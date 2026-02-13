# CentOS 1GB 서버 설정 가이드 (NeonTunnel Relay)

## 1. Node.js 16 설치
CentOS 7/8 기준으로 Node.js 16 버전을 설치하는 방법입니다.

```bash
# 1. NodeSource 레포지토리 추가 (v16.x)
curl -fsSL https://rpm.nodesource.com/setup_16.x | sudo bash -

# 2. Node.js 설치 (npm 포함)
sudo yum install -y nodejs

# 3. 설치 확인
node -v  # v16.xx.x 출력되면 성공
npm -v
```

## 2. PM2 (프로세스 매니저) 설치
PM2는 서버가 재부팅되거나 에러로 꺼져도 자동으로 다시 실행시켜주는 도구입니다.

```bash
# 1. 전역으로 pm2 설치
sudo npm install -g pm2

# 2. 설치 확인
pm2 -v
```

## 3. Relay Server 실행 및 등록
NeonTunnel Relay 서버를 PM2로 실행합니다.

```bash
# 1. 릴레이 서버 폴더로 이동
cd ~/NeonTunnel/relay-server

# 2. 의존성 설치 (아직 안 했다면)
npm install

# 3. PM2로 실행 (이름: relay)
pm2 start index.js --name "relay"

# 4. 서버 재부팅 시 자동 실행 등록
pm2 startup
# (위 명령어를 치면 나오는 'sudo env PATH...' 명령어를 복사해서 그대로 실행하세요!)

# 5. 현재 리스트 저장
pm2 save
```

## 4. (선택) 로그 확인 및 모니터링
```bash
# 실시간 로그 확인
pm2 logs relay

# 상태 확인 (CPU, 메모리 사용량)
pm2 monit
```
