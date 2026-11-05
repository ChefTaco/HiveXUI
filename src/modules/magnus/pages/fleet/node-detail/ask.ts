/** A confirmation the page shows outside any animated block, with a label saying what will happen. */
export interface AskRequest {
  title: string;
  message: string;
  label: string;
  action: () => void | Promise<void>;
}
export type Ask = (request: AskRequest) => void;
