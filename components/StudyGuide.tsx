import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icons } from './Icon';

interface StudyGuideProps {
  content: string;
}

const StudyGuide: React.FC<StudyGuideProps> = ({ content }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden relative group">
      {/* Copy Button Toolbar */}
      <div className="absolute top-4 right-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <button
          onClick={handleCopy}
          className={`
            flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm font-medium shadow-sm transition-all
            ${copied 
              ? 'bg-green-50 text-green-700 border border-green-200' 
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900'
            }
          `}
        >
          {copied ? (
            <>
              <Icons.Check size={16} />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Icons.Copy size={16} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      <div className="p-8 md:p-12 prose prose-slate prose-headings:font-serif prose-headings:text-slate-800 prose-p:text-slate-600 prose-li:text-slate-600 max-w-none">
        <ReactMarkdown
           remarkPlugins={[remarkGfm]}
           components={{
            h1: ({node, ...props}) => <h1 className="text-3xl font-bold border-b border-slate-200 pb-4 mb-6 text-primary-900" {...props} />,
            h2: ({node, ...props}) => <h2 className="text-2xl font-semibold mt-8 mb-4 text-primary-800" {...props} />,
            h3: ({node, ...props}) => <h3 className="text-xl font-medium mt-6 mb-3 text-slate-800 flex items-center gap-2" {...props} />,
            ul: ({node, ...props}) => <ul className="list-disc pl-5 space-y-2 mb-4" {...props} />,
            li: ({node, ...props}) => <li className="text-slate-700 leading-relaxed" {...props} />,
            strong: ({node, ...props}) => <strong className="font-semibold text-slate-900 bg-yellow-50 px-1 rounded" {...props} />,
            blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-primary-300 pl-4 italic text-slate-500 my-4" {...props} />,
            table: ({node, ...props}) => (
              <div className="overflow-x-auto my-4">
                <table className="min-w-full border border-slate-200 text-sm" {...props} />
              </div>
            ),
            thead: ({node, ...props}) => <thead className="bg-slate-50" {...props} />,
            th: ({node, ...props}) => (
              <th
                className="border border-slate-200 px-3 py-2 text-left font-semibold text-slate-700"
                {...props}
              />
            ),
            td: ({node, ...props}) => (
              <td className="border border-slate-200 px-3 py-2 align-top text-slate-700" {...props} />
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
};

export default StudyGuide;
