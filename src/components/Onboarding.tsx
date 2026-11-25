"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import BottomNav from "./BottomNav";
import { CollectionCover, RoomCard, toneStyle } from "./Palette";
import { RoomCards } from "./Rooms";
import cl from "./CollectionsList.module.css";
import styles from "./Onboarding.module.css";
import {
  EXAMPLE_COLLECTIONS, ONBOARDING_REPLAY_EVENT, ONBOARDING_STEPS, coachNumber, fetchOnboarded, markOnboarded, needsServerMark,
  readLocalOnboarded, shouldShowOnboarding, takeInvite, takeOnboardingReplay, welcomeTitle, writeLocalOnboarded,
  type InvitedWelcome, type OnboardingStep,
} from "@/lib/onboarding";
import type { RoomSummary } from "@/lib/rooms";
import { INVITE_DAYS } from "@/lib/folders";

/**
 * 처음 사용법(온보딩, 시안 design-lab/onboarding 1~7번).
 * 환영 → ① 인스타 Copy link → ② + 버튼 → ③ 방 버튼 → ④ 모음 → ⑤ 친구 초대 → 마무리.
 * ②·③은 실제 지도 위의 + 버튼·방 버튼에 구멍을 내고(실행 중 위치를 재서 맞춤), ①·④·⑤는 온보딩 층 안의 그림으로 보여 줍니다.
 */

/** 이 계정에서 보여 줄지(페이지가 열려 있는 동안 계정마다 한 번만 서버에 묻습니다). */
const decisions = new Map<string, Promise<{ show: boolean; invited: InvitedWelcome | null }>>();
function decide(userId: string) {
  let decision = decisions.get(userId);
  if (!decision) {
    decision = (async () => {
      const local = readLocalOnboarded(userId);
      const server = await fetchOnboarded();
      if (needsServerMark(server, local)) void markOnboarded();
      if (server === true) writeLocalOnboarded(userId);
      const show = shouldShowOnboarding(server, readLocalOnboarded(userId));
      return { show, invited: show ? takeInvite() : null };
    })();
    decisions.set(userId, decision);
  }
  return decision;
}

/** 로그인·약관 뒤 지도에 처음 들어오면 열고, 설정 → 사용법 다시 보기로 다시 엽니다. */
export function useOnboarding(userId: string | null, active: boolean) {
  const [open, setOpen] = useState(false);
  const [invited, setInvited] = useState<InvitedWelcome | null>(null);
  useEffect(() => {
    const replay = () => { if (takeOnboardingReplay()) { setInvited(null); setOpen(true); } };
    replay();
    window.addEventListener(ONBOARDING_REPLAY_EVENT, replay);
    return () => window.removeEventListener(ONBOARDING_REPLAY_EVENT, replay);
  }, []);
  useEffect(() => {
    if (!userId || !active) return;
    let alive = true;
    void decide(userId).then((result) => {
      if (!alive || !result.show) return;
      decisions.set(userId, Promise.resolve({ show: false, invited: null }));
      setInvited(result.invited); setOpen(true);
    });
    return () => { alive = false; };
  }, [userId, active]);
  /** 끝까지 보거나 건너뛰면 계정과 이 기기에 "봤음"을 적습니다(다시 보기도 같은 기록이라 그대로 둡니다). */
  const finish = useCallback(() => {
    setOpen(false);
    if (!userId) return;
    decisions.set(userId, Promise.resolve({ show: false, invited: null }));
    writeLocalOnboarded(userId); void markOnboarded();
  }, [userId]);
  return { open: open && active, invited, finish };
}

export interface OnboardingRoom { name: string; color?: string | null; placeCount: number; members: readonly string[] }
export interface OnboardingCollection { id: string; name: string; icon?: string | null; color?: string | null; count: number }
export type OnboardingEnd = "skip" | "done" | "later" | "add";

interface Rect { left: number; top: number; width: number; height: number }
interface CoachSpec { kicker: string; title: string; body: ReactNode; target: () => Element | null; pad: number; radius: number }

const DOT_COUNT = 6;
function Dots({ index }: { index: number }) {
  return <span className={styles.dots} aria-hidden="true">{Array.from({ length: DOT_COUNT }, (_, i) => <i key={i} className={i === index ? styles.on : undefined} />)}</span>;
}
/** 꺼진(inert) 그림: 누르거나 읽히지 않습니다. */
const inertRef = (element: HTMLElement | null) => { if (element) element.inert = true; };

export default function Onboarding({ rooms, roomScope, room, collections, placeCount, invited, onEnd }: {
  rooms: readonly RoomSummary[] | null; roomScope: "all" | string | null; room: OnboardingRoom;
  collections: readonly OnboardingCollection[]; placeCount: number; invited: InvitedWelcome | null; onEnd: (reason: OnboardingEnd) => void;
}) {
  const [index, setIndex] = useState(0);
  const step: OnboardingStep = ONBOARDING_STEPS[index];
  const titleId = useId(), bodyId = useId();
  const layer = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLSpanElement>(null), listRef = useRef<HTMLDivElement>(null), inviteRef = useRef<HTMLDivElement>(null);
  const stack = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [view, setView] = useState({ width: 0, height: 0, stack: 0 });
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const coaches: Partial<Record<OnboardingStep, CoachSpec>> = {
    copy: { kicker: "장소 담기", title: "인스타에서 ‘Copy link’", target: () => copyRef.current, pad: 6, radius: 20,
      body: <>마음에 드는 게시물·릴스에서 종이비행기(공유)를 누르고 <b>Copy link</b>로 링크를 복사해요.</> },
    plus: { kicker: "장소 담기", title: "+ 누르고 붙여넣기", target: () => document.querySelector(".map-controls .save-fab"), pad: 6, radius: 999,
      body: <>앱으로 돌아와 <b>+</b>를 누르고, 링크 칸을 길게 눌러 붙여넣어요. 캡션에서 가게를 찾아 방에 담아 줘요.</> },
    room: { kicker: "방 바꾸기", title: "방 버튼으로 전체 ↔ 방", target: () => document.querySelector(".room-scope-btn"), pad: 6, radius: 999,
      body: <>네 칸 버튼을 누르면 ‘내 방’ 카드가 열려요. <b>전체</b>로 모든 방을 함께 보거나, 방 하나로 들어가요. 카드의 ⚙로 방 설정도 바로 가요.</> },
    collections: { kicker: "모음", title: "방 안에서 모음으로 묶기", target: () => listRef.current, pad: 8, radius: 24,
      body: <>리스트 탭의 <b>모음</b>에서 ‘성수 카페 투어’, ‘첫날 · 둘째날’처럼 장소를 묶어요. 방을 또 만들 필요 없이, 같은 방 사람들과 함께 정리해요.</> },
    invite: { kicker: "친구 초대", title: "방을 함께 쓰려면 초대 링크", target: () => inviteRef.current, pad: 8, radius: 26,
      body: <>방 설정의 <b>초대 링크</b>를 보내면 연인·친구가 같은 방에서 장소를 함께 담아요. 친구가 담으면 지도에 <b>NEW</b>로 알려 줘요.</> },
  };
  const coach = coaches[step];

  // 구멍 위치: 실제 버튼·그림의 자리를 매 프레임 재서 화면이 바뀌어도(회전·키보드·지도 이동) 맞춥니다.
  useLayoutEffect(() => {
    let frame = 0, last = "";
    const tick = () => {
      const target = coach?.target();
      const box = target?.getBoundingClientRect();
      const next = box && box.width > 0 && box.height > 0 ? { left: box.left, top: box.top, width: box.width, height: box.height } : null;
      const height = stack.current?.offsetHeight ?? 0;
      const key = `${next ? `${next.left},${next.top},${next.width},${next.height}` : "-"}|${window.innerWidth}x${window.innerHeight}|${height}`;
      if (key !== last) { last = key; setRect(next); setView({ width: window.innerWidth, height: window.innerHeight, stack: height }); }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [step]);

  // 단계가 바뀌면 대화상자로 포커스를 옮겨 새 제목·설명을 읽게 합니다. 닫히면 원래 자리로 돌려줍니다.
  useEffect(() => { layer.current?.focus({ preventScroll: true }); }, [step, mounted]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  const next = () => { if (index < ONBOARDING_STEPS.length - 1) setIndex(index + 1); };
  const end = (reason: OnboardingEnd) => onEnd(reason);
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); end(step === "finish" ? "later" : "skip"); return; }
    if (event.key !== "Tab" || !layer.current) return;
    const items = [...layer.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]")].filter((el) => !el.closest("[inert]"));
    if (!items.length) { event.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1], current = document.activeElement;
    if (event.shiftKey && (current === first || current === layer.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && current === last) { event.preventDefault(); first.focus(); }
  }

  // 말풍선 자리: 구멍 아래에 공간이 있으면 아래, 아니면 위. 꼬리는 구멍 가운데를 가리킵니다.
  const gap = 14, margin = 18;
  const width = Math.min(Math.max(view.width - margin * 2, 0), 420);
  const hole = rect && coach ? { left: rect.left - coach.pad, top: rect.top - coach.pad, width: rect.width + coach.pad * 2, height: rect.height + coach.pad * 2 } : null;
  let place: CSSProperties = {}, below = true, arrow = width / 2;
  if (hole) {
    const center = hole.left + hole.width / 2;
    const left = Math.min(Math.max(center - width / 2, margin), Math.max(view.width - margin - width, margin));
    const spaceBelow = view.height - (hole.top + hole.height) - gap - margin, spaceAbove = hole.top - gap - margin;
    below = spaceBelow >= view.stack || spaceBelow >= spaceAbove;
    arrow = Math.min(Math.max(center - left, 26), width - 26);
    place = below ? { left, width, top: hole.top + hole.height + gap } : { left, width, bottom: view.height - hole.top + gap };
  } else place = { left: Math.max((view.width - width) / 2, margin), width, top: "50%", transform: "translateY(-50%)" };

  const last = step === "invite";
  const n = coachNumber(step);
  const roomPreview = step === "room" && rooms && rooms.length > 0
    ? <div className={styles.extra} ref={inertRef} aria-hidden="true"><RoomCards rooms={rooms} compact withAll selected={roomScope} onPick={() => {}} /></div> : null;

  const welcome = welcomeTitle(invited);
  const content = <div ref={layer} className={styles.layer} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} tabIndex={-1} onKeyDown={keyDown} data-step={step}>
    {step === "welcome" && <section className={styles.card}>
      <div className={styles.art}><MapArt /></div>
      <h1 id={titleId} className={styles.headline}>{welcome.lead}<br /><em>{welcome.em}</em></h1>
      <p id={bodyId} className={styles.lead}>{invited ? <>같은 방에서 가고 싶은 곳을 함께 담아요. 쓰는 법을 1분만 볼까요?</> : <>혼자, 연인과, 친구들과 — 방을 만들어 가고 싶은 곳을 함께 담아요. 1분이면 다 알아요.</>}</p>
      <div className={styles.bar}><Dots index={0} /><button type="button" className={styles.skip} onClick={() => end("skip")}>건너뛰기</button><button type="button" className={styles.go} onClick={next}>시작</button></div>
    </section>}

    {step === "copy" && <InstagramShare copyRef={copyRef} />}
    {step === "collections" && <CollectionsScreen listRef={listRef} room={room} collections={collections} placeCount={placeCount} />}
    {step === "invite" && <InviteScreen inviteRef={inviteRef} room={room} />}

    {coach && <>
      {hole ? <div className={styles.hole} style={{ ...hole, borderRadius: coach.radius }} aria-hidden="true" /> : <div className={styles.dim} aria-hidden="true" />}
      <div ref={stack} className={styles.stack} style={{ ...place, visibility: view.width ? "visible" : "hidden" }}>
        <div className={`${styles.coach} ${below ? styles.below : styles.above}`} style={{ "--arrow": `${arrow}px` } as CSSProperties}>
          <p className={styles.step}>{n} / 5 · {coach.kicker}</p>
          <h2 id={titleId}>{coach.title}</h2>
          <p id={bodyId} className={styles.body}>{coach.body}</p>
          <div className={styles.cbar}><Dots index={n} /><button type="button" className={styles.skip} onClick={() => end("skip")}>건너뛰기</button><button type="button" className={styles.next} onClick={next}>{last ? "시작하기" : "다음"}</button></div>
        </div>
        {roomPreview}
      </div>
    </>}

    {step === "finish" && <section className={styles.card}>
      <div className={styles.art}><ul className={styles.recap}>
        <li><span className={styles.recapIcon}><Icon name="link" width={20} /></span>인스타에서 Copy link → + → 붙여넣기</li>
        <li><span className={styles.recapIcon}><Icon name="map" width={20} /></span>방 버튼으로 전체 ↔ 방 바꾸기</li>
        <li><span className={styles.recapIcon}><Icon name="collection" width={20} /></span>방 안에서 모음으로 묶기(첫날·둘째날)</li>
        <li><span className={styles.recapIcon}><Icon name="user" width={20} /></span>초대 링크로 연인·친구와 함께</li>
      </ul></div>
      <h1 id={titleId} className={styles.headline}>이제 <em>첫 장소</em>를<br />담아 볼까요?</h1>
      <p id={bodyId} className={styles.lead}>사용법은 <b>설정 → 사용법 다시 보기</b>에서 언제든 다시 볼 수 있어요.</p>
      <div className={styles.bar}><button type="button" className={styles.skip} onClick={() => end("later")}>나중에</button><span className={styles.spacer} /><button type="button" className={styles.go} onClick={() => end("add")}><Icon name="plus" width={20} />장소 담기</button></div>
    </section>}
  </div>;
  return mounted ? createPortal(content, document.body) : null;
}

/** 환영 카드 그림: 원단 지도 위 방 색 핀 몇 개(실제 장소가 아닌 예시) */
function MapArt() {
  const pins: [string, number, number, string][] = [["성수 카페", 30, 26, "red"], ["바다 산책", 66, 46, "teal"], ["파스타 집", 32, 70, "red"], ["국밥 골목", 70, 84, "navy"]];
  return <div className={styles.mapArt} aria-hidden="true">
    {pins.map(([name, x, y, color]) => <span key={name} className={styles.miniPin} style={{ left: `${x}%`, top: `${y}%`, ...toneStyle(color) }}>{name}</span>)}
  </div>;
}

/** ① 인스타 공유 시트 그림(사람 사진·이름 없이). Copy link 동그라미에 구멍을 냅니다. */
function InstagramShare({ copyRef }: { copyRef: RefObject<HTMLSpanElement | null> }) {
  return <div className={styles.ig} ref={inertRef} aria-hidden="true">
    <div className={styles.post}><b>성수 디저트 맛집</b>캡션에 가게 이름이 있는<br />게시물이나 릴스</div>
    <div className={styles.igSheet}>
      <i className={styles.igGrab} />
      <div className={styles.igSearch}><Icon name="search" width={18} />Search</div>
      <div className={styles.igPeople}>{["친구 1", "친구 2", "친구 3", "친구 4", "친구 5", "친구 6"].map((name) => <span key={name}><i />{name}</span>)}</div>
      <div className={styles.igActions}>
        <span ref={copyRef} className={styles.igCopy}><span className={styles.igIcon}><Icon name="link" width={24} /></span>Copy link</span>
        <span><span className={styles.igIcon}><Icon name="external" width={22} /></span>Share to…</span>
        <span><span className={styles.igIcon}><Icon name="plus" width={24} /></span>Add to story</span>
        <span><span className={styles.igIcon}><Icon name="more" width={24} /></span>More</span>
      </div>
    </div>
  </div>;
}

/** 위 줄 모양(검색 · 방 버튼 · 설정)만 그린 것 */
function FakeTopBar({ room }: { room: OnboardingRoom }) {
  return <div className={styles.fakeTop}>
    <span className={styles.fakeSearch}><Icon name="search" width={20} />{room.name}에서 검색</span>
    <span className={styles.fakeRound}><Icon name="rooms" width={21} /></span>
    <span className={styles.fakeRound}><Icon name="settings" width={21} /></span>
  </div>;
}

/** ④ 리스트 탭의 모음 칸. 이 방에 모음이 없으면 예시(첫날·둘째날·셋째날)를 보여 줍니다. */
function CollectionsScreen({ listRef, room, collections, placeCount }: { listRef: RefObject<HTMLDivElement | null>; room: OnboardingRoom; collections: readonly OnboardingCollection[]; placeCount: number }) {
  const real = collections.length > 0;
  const shown = real ? collections.slice(0, 3) : EXAMPLE_COLLECTIONS;
  return <div className={styles.screen} ref={inertRef} aria-hidden="true">
    <FakeTopBar room={room} />
    <div ref={listRef} className={styles.listArea}>
      <div className={cl.switch}><button type="button" tabIndex={-1} aria-pressed={false}>장소{real && <> <span className="switch-count">{placeCount}</span></>}</button><button type="button" tabIndex={-1} aria-pressed>모음 <span className="switch-count">{real ? collections.length : shown.length}</span></button></div>
      {!real && <p className={styles.listLabel}>모음 예시</p>}
      <div className={cl.mlist}>
        {shown.map((c) => <span key={c.id} className={cl.mrow}><CollectionCover icon={c.icon} size={52} /><span className={cl.mcopy}><strong>{c.name}</strong><small>장소 {c.count}곳</small></span><Icon name="chevron" width={18} /></span>)}
        <span className={`${cl.mrow} ${cl.mrowAdd}`}><span className={cl.addTile}><Icon name="plus" width={22} /></span><span className={cl.mcopy}><strong>새 모음</strong><small>이 방 안에 만들어요</small></span></span>
      </div>
    </div>
    <BottomNav hidden={false} current="list" />
  </div>;
}

/** ⑤ 방 설정의 초대 줄(링크 복사 · 보내기) */
function InviteScreen({ inviteRef, room }: { inviteRef: RefObject<HTMLDivElement | null>; room: OnboardingRoom }) {
  const members = room.members.length;
  return <div className={styles.screen} ref={inertRef} aria-hidden="true">
    <div className={styles.fakeHeader}><Icon name="back" width={22} /><span>방 설정</span><i /></div>
    <RoomCard color={room.color || "red"} kicker="방" name={room.name} meta={`장소 ${room.placeCount}곳 · 멤버 ${Math.max(members, 1)}명`} />
    <div className={styles.inviteRow}><Icon name="user" /><span><strong>멤버</strong><small>{members ? room.members.slice(0, 4).join(" · ") : "나"}</small></span><Icon name="chevron" width={18} /></div>
    <div className={styles.inviteBox}>
      <strong>초대 링크</strong>
      <small>링크를 받은 사람은 이 방에 들어와요 · {INVITE_DAYS}일 동안</small>
      <div ref={inviteRef} className={styles.inviteActions}><span className="btn"><Icon name="copy" width={18} />링크 복사</span><span className="btn primary"><Icon name="link" width={18} />보내기</span></div>
    </div>
  </div>;
}
