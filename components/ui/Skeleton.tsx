interface SkeletonProps {
  rows?: number
}

export function Skeleton({ rows = 5 }: SkeletonProps) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {Array.from({ length: rows }).map((_, i) => (
          <tr key={i} className="border-t border-gray-200 dark:border-gray-700">
            {[1, 2, 3, 4, 5].map((j) => (
              <td key={j} className="px-4 py-3">
                <div className="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
