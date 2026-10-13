// Next.js re-mounts a template on every navigation, so each page fades in as it opens.
export default function Template({ children }) {
  return <div className="animate-page-in">{children}</div>;
}
