import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "highlight.js/styles/github-dark.css";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/** Renders untrusted Markdown without allowing raw HTML. */
export const MarkdownRenderer = memo(({ content, className = "" }: MarkdownRendererProps) => (
  <div className={`markdown-content text-left ${className}`}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      components={{
        h1: ({ children }) => <h1 className="text-sm font-bold text-[var(--text-light)] mt-5 mb-2.5">{children}</h1>,
        h2: ({ children }) => <h2 className="text-xs font-bold text-[var(--text-light)] mt-4 mb-2 border-b border-[var(--border-color)]/30 pb-1">{children}</h2>,
        h3: ({ children }) => <h3 className="text-[11px] font-bold text-[var(--text-light)] mt-3 mb-1.5 uppercase font-mono tracking-wider">{children}</h3>,
        p: ({ children }) => <p className="leading-relaxed text-[11px] text-[var(--text-normal)] my-1">{children}</p>,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300 underline font-semibold transition-colors">
            {children}
          </a>
        ),
        ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 my-2">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1 my-2">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed text-[11px] text-[var(--text-normal)]">{children}</li>,
        blockquote: ({ children }) => <blockquote className="border-l-4 border-violet-500/50 pl-3 py-1 my-2 bg-[var(--bg-sidebar)]/20 rounded-r text-[var(--text-muted)] italic">{children}</blockquote>,
        table: ({ children }) => <table className="w-full text-left border-collapse font-sans text-[11px]">{children}</table>,
        thead: ({ children }) => <thead className="bg-[var(--bg-sidebar)] border-b border-[var(--border-color)]">{children}</thead>,
        th: ({ children }) => <th className="px-3 py-2 font-semibold text-[var(--text-light)]">{children}</th>,
        td: ({ children }) => <td className="px-3 py-2 text-[var(--text-normal)]">{children}</td>,
        tr: ({ children }) => <tr className="border-b border-[var(--border-color)]/40 last:border-none hover:bg-[var(--bg-sidebar)]/35 transition-colors">{children}</tr>,
        code: ({ children, className: codeClassName, ...props }) => {
          const isBlock = Boolean(codeClassName?.includes("language-"));
          return isBlock ? (
            <code className={`${codeClassName ?? ""} font-mono text-[11px] leading-relaxed`} {...props}>{children}</code>
          ) : (
            <code className="px-1.5 py-0.5 rounded bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-rose-400 font-mono text-[11px]" {...props}>{children}</code>
          );
        },
        pre: ({ children }) => <pre className="my-3 whitespace-pre-wrap break-words rounded-lg border border-[var(--border-color)] bg-[#0d1117] p-3">{children}</pre>,
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
));

