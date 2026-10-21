import AddForm from "./AddForm";

export const dynamic = "force-dynamic";

/**
 * 링크 추가 화면.
 * - 단축어(간단 버전): /add?t=토큰&who=이름&url=<공유한 링크> 를 열면 바로 처리합니다.
 * - 직접 쓰기: 지도에서 "+ 링크"를 눌러 들어와 링크를 붙여넣습니다.
 */
export default function AddPage({ searchParams }: { searchParams: { t?: string; who?: string; url?: string } }) {
  const token = searchParams.t ?? "";
  if (!token) {
    return (
      <main className="confirm">
        <h1>보드 주소가 필요해요</h1>
        <p className="lead">
          <code>?t=보드토큰</code>이 붙은 주소로 열어 주세요.
        </p>
      </main>
    );
  }
  return <AddForm token={token} who={searchParams.who ?? ""} initialUrl={searchParams.url ?? ""} />;
}
