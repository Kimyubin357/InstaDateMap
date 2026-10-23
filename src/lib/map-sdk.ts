import { forgetScript, loadScript } from "./scripts";

let loading: Promise<any> | undefined;

// The full SDK readiness promise is shared by the main map and detail previews.
// A failed download must not leave either surface waiting on a rejected cache.
export function loadKakaoMaps(apiKey: string): Promise<any> {
  if (window.kakao?.maps?.Map) return Promise.resolve(window.kakao.maps);
  if (loading) return loading;
  const attempt = loadScript(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(apiKey)}&autoload=false&libraries=services`, "kakao-sdk")
    .then(() => new Promise<any>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (error) reject(error); else resolve(window.kakao.maps);
      };
      const timer = setTimeout(() => finish(new Error("지도를 준비하는 시간이 길어졌어요.")), 10000);
      try {
        if (!window.kakao?.maps?.load) throw new Error("지도 기능을 준비하지 못했어요.");
        window.kakao.maps.load(() => finish(window.kakao?.maps?.Map ? undefined : new Error("지도를 준비하지 못했어요.")));
      } catch (error) { finish(error instanceof Error ? error : new Error("지도를 준비하지 못했어요.")); }
    }))
    .catch((error) => {
      if (!window.kakao?.maps?.Map) forgetScript("kakao-sdk");
      throw error;
    });
  loading = attempt;
  void attempt.then(() => { if (loading === attempt) loading = undefined; }, () => { if (loading === attempt) loading = undefined; });
  return attempt;
}
