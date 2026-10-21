import Link from "next/link";
import Icon from "./Icon";
/** Shared search entry and settings sit inside the iPhone safe area, above the map. */
export default function FloatingSearchBar() {
  return <div className="floating-search-bar">
    <Link href="/search" className="map-search-entry" aria-label="장소 검색"><Icon name="search" width="20" /><span>장소 이름, 지역으로 검색</span></Link>
    <Link href="/settings" className="icon-btn floating-settings" aria-label="우리 설정"><Icon name="settings" width="21" /></Link>
  </div>;
}
