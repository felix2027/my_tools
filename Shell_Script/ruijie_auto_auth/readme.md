## 锐捷校园认证，适用于重科

- /etc/ruijie/ruijie.sh

  ```sh
  mkdir /etc/ruijie
  vi /etc/ruijie/ruijie.sh
  ```

  内容

  ```sh
  #!/bin/sh
  
  if [ "$#" -lt 2 ]; then
      echo "Usage: $0 username password"
      exit 1
  fi
  
  USERNAME="$1"
  PASSWORD="$2"
  CHECK_URL="http://www.google.cn/generate_204"
  
  CODE=$(curl -s -o /dev/null -w '%{http_code}' \
      --connect-timeout 5 \
      --max-time 10 \
      "$CHECK_URL")
  
  if [ "$CODE" = "204" ]; then
      echo "Already online."
      exit 0
  fi
  
  LOGIN_PAGE=$(curl -s \
      --connect-timeout 5 \
      --max-time 10 \
      "$CHECK_URL" |
      awk -F "'" 'NF >= 2 {print $2; exit}')
  
  if [ -z "$LOGIN_PAGE" ]; then
      echo "Failed to get login page."
      exit 1
  fi
  
  LOGIN_URL=$(printf '%s\n' "$LOGIN_PAGE" |
      awk -F '?' '{print $1}')
  
  LOGIN_URL=$(printf '%s\n' "$LOGIN_URL" |
      sed 's/index\.jsp/InterFace.do?method=login/')
  
  QUERY_STRING=$(printf '%s\n' "$LOGIN_PAGE" |
      sed -n 's/.*[?&]wlanuserip=\([^&]*\).*/\1/p')
  
  if [ -z "$QUERY_STRING" ]; then
      echo "Failed to get queryString."
      exit 1
  fi
  
  RESULT=$(curl -s \
      --connect-timeout 5 \
      --max-time 15 \
      -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/61.0.3163.91 Safari/537.36" \
      -e "$LOGIN_PAGE" \
      -b "EPORTAL_COOKIE_USERNAME=; EPORTAL_COOKIE_PASSWORD=; EPORTAL_COOKIE_SERVER=; EPORTAL_COOKIE_SERVER_NAME=; EPORTAL_AUTO_LAND=; EPORTAL_USER_GROUP=; EPORTAL_COOKIE_OPERATORPWD=;" \
      -H "Content-Type: application/x-www-form-urlencoded; charset=UTF-8" \
      -d "userId=$USERNAME" \
      -d "password=$PASSWORD" \
      -d "service=" \
      -d "queryString=$QUERY_STRING" \
      -d "operatorPwd=" \
      -d "operatorUserId=" \
      -d "validcode=" \
      -d "passwordEncrypt=false" \
      "$LOGIN_URL")
  
  echo "$RESULT"
  
  case "$RESULT" in
      *'"result":"success"'*)
          echo "Ruijie login successful."
          exit 0
          ;;
      *)
          echo "Ruijie login failed."
          exit 1
          ;;
  esac
  ```

- 账号密码配置文件

  ```sh
  vi /etc/ruijie/config
  ```

  内容（校园网账号密码）

  ```sh
  USERNAME="《USERNAME》"
  PASSWORD="《PASSWORD》"
  ```

- 自动认证服务

  ```sh
  vi /etc/init.d/ruijie
  ```

  内容

  ```sh
  #!/bin/sh /etc/rc.common
  
  START=99
  STOP=10
  
  USE_PROCD=1
  
  start_service() {
      . /etc/ruijie/config
  
      procd_open_instance
  
      procd_set_param command /bin/sh -c "
          while true
          do
              /etc/ruijie/ruijie.sh \"$USERNAME\" \"$PASSWORD\"
              sleep 600
          done
      "
  
      procd_set_param respawn 3600 5 5
      procd_close_instance
  }
  ```

  

- 最终配置

  ```sh
  #权限
  chmod 600 /etc/ruijie/config
  chmod +x /etc/ruijie/ruijie.sh
  chmod +x /etc/init.d/ruijie
  
  #启动
  /etc/init.d/ruijie enable
  /etc/init.d/ruijie start
  /etc/init.d/ruijie status
  ```

- 结束
