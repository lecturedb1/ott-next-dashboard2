[text](../Project/data-analysis-beginner/.github)# OTT Next Dashboard

Supabase의 `ott_weekly`, `ott_services`, `event_types` 데이터를 Next.js Server Component에서 조회하고 Chart.js로 보여주는 간단한 대시보드입니다.

## 실행

1. `.env.local`에 Supabase 접속 정보와 데이터 담당자 이메일 또는 사용자 ID를 추가합니다.

```bash
NEXT_PUBLIC_DATA_MANAGER_EMAILS=manager@example.com,dfe6fce5-86c7-468c-8b09-0a7a293210ae
```
2. 필요한 패키지를 설치합니다.

```bash
npm install
```

3. 개발 서버를 실행합니다.

```bash
npm run dev
```

4. 브라우저에서 `http://localhost:3000`으로 접속합니다.
