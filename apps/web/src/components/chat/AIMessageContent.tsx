'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

const components: Components = {
  h1: ({ children }) => <h1>{children}</h1>,
  h2: ({ children }) => <h2>{children}</h2>,
  h3: ({ children }) => <h3>{children}</h3>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  table: ({ children }) => <div className="markdown-table-wrap"><table>{children}</table></div>,
  code: ({ children, className, ...props }) => {
    const isBlock = Boolean(className?.includes('language-')) || String(children).includes('\n');
    return isBlock
      ? <code className={className} {...props}>{children}</code>
      : <code className="inline-code" {...props}>{children}</code>;
  }
};

export function AIMessageContent({ content }: { content: string }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
