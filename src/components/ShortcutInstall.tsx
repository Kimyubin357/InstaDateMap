import Icon from "./Icon";

export default function ShortcutInstall({ href = "https://www.icloud.com/shortcuts/6f8893730bdd41bebc20e0a5caa129ab" }: { href?: string }) {
  return <section className="settings-section shortcut-install">
    <h2><Icon name="link" />인스타에서 바로 저장하기</h2>
    <p className="lead">단축어를 추가하면 인스타 공유 메뉴에서 발견한 곳을 우리 지도로 보낼 수 있어요.</p>
    <a className="btn primary shortcut-install-button" href={href}><Icon name="plus" width="20" />아이폰 단축어 추가</a>
    <p className="hint shortcut-install-hint">아이폰·아이패드의 단축어 앱에서 ‘단축어 추가’를 눌러 마무리해 주세요.</p>
    <h3>추가한 뒤 이렇게 저장해요</h3>
    <ol className="shortcut-install-steps">
      <li>인스타 게시물에서 <strong>공유</strong>를 눌러요.</li>
      <li><strong>더보기</strong>로 아이폰 공유 메뉴를 열어요.</li>
      <li><strong>데이트맵에 저장</strong>을 선택해요.</li>
    </ol>
  </section>;
}
