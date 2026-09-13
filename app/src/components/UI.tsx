export type View = "home" | "campaigns" | "create" | "join" | "guide" | "faucet";
export type Navigate = (view: View) => void;
type IconName = "home" | "circles" | "plus" | "enter" | "book" | "wallet" | "arrow" | "check";
export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v10H3Z" /><path d="M9 20v-7h6v7" /></>,
    circles: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 4v3" /></>,
    plus: <path d="M12 4v16M4 12h16" />,
    enter: <><path d="M13 4h7v16h-7M3 12h12m-5-5 5 5-5 5" /></>,
    book: <><path d="M12 5v15M3 4h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3Z" /></>,
    wallet: <><path d="M20 7H4V4l14-1v4M4 7v13h17V7Zm12 5h5v4h-5Z" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
