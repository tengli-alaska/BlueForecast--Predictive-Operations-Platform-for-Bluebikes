"use client";

import { motion } from "framer-motion";

interface Column<T> {
  key: string;
  label: string;
  render?: (value: unknown, row: T) => React.ReactNode;
}

interface DataTableProps<T extends Record<string, unknown>> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
}

const rowVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.04,
      duration: 0.3,
      ease: "easeOut" as const,
    },
  }),
};

export default function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  onRowClick,
}: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-bg-secondary">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-secondary"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <motion.tr
              key={i}
              custom={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={rowVariants}
              onClick={() => onRowClick?.(row)}
              className={`border-b border-border/50 transition-colors last:border-0 ${
                onRowClick
                  ? "cursor-pointer hover:bg-bg-tertiary"
                  : ""
              }`}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className="px-4 py-3 text-text-primary"
                >
                  {col.render
                    ? col.render(row[col.key], row)
                    : (row[col.key] as React.ReactNode)}
                </td>
              ))}
            </motion.tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-text-secondary"
              >
                No data available
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
