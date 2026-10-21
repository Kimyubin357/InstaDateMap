import MapApp from "./MapApp";

export const dynamic = "force-dynamic";

export default function Page({ searchParams }: { searchParams: { t?: string; who?: string } }) {
  const token = searchParams.t ?? "";
  if (!token) {
    return (
      <main className="confirm">
        <h1>보드 주소가 필요해요</h1>
        <p className="lead">
          지도는 <code>?t=보드토큰</code>이 붙은 주소로 열어야 해요. 처음 설정할 때 받은 주소를 홈 화면에 추가해 두세요.
        </p>
      </main>
    );
  }
  return <MapApp token={token} who={searchParams.who ?? ""} kakaoKey={process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? ""} />;
}
