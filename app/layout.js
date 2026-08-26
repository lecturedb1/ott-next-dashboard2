import "./globals.css";

export const metadata = {
  title: "OTT Weekly Dashboard",
  description: "Supabase 데이터를 바로 보여주는 OTT 분석 대시보드",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
