import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { safeUrl } from "./format";

/** Renders AI Markdown safely: no raw HTML (react-markdown default), only http(s) links, opened in a new tab. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed [&_li]:ml-5 [&_ol]:list-decimal [&_strong]:font-semibold [&_table]:w-full [&_td]:border [&_td]:p-1 [&_th]:border [&_th]:p-1 [&_ul]:list-disc">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: c }) => {
            // In-page citation links from components/legal/parse.ts#linkCitations ("#src-<n>").
            if (href && /^#src-\d{1,3}$/.test(href)) {
              return (
                <a
                  href={href}
                  className="mx-0.5 inline-flex min-w-5 items-center justify-center rounded bg-accent px-1 align-baseline text-xs font-semibold text-primary no-underline"
                >
                  [{c}]
                </a>
              );
            }
            const url = safeUrl(href);
            return url ? (
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                {c}
              </a>
            ) : (
              <span>{c}</span>
            );
          },
          img: () => null,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
