export const SEARCH_PAGE_SIZE = 8;
export const MAX_SEARCH_PAGE = 45;
export function validSearchPage(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SEARCH_PAGE;
}
