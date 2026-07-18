"use client";
import { int } from "./format";

// ⑤ 錯誤 top — errorCode 次數排行。
export function ErrorTop({ errors }: { errors: { errorCode: string; count: number }[] }) {
  if (errors.length === 0) return <p className="muted good">此區間內未有錯誤。</p>;
  return (
    <div className="tbl-wrap">
      <table className="usage">
        <thead>
          <tr>
            <th>錯誤代碼</th>
            <th className="num">次數</th>
          </tr>
        </thead>
        <tbody>
          {errors.map((e) => (
            <tr key={e.errorCode}>
              <td>{e.errorCode}</td>
              <td className="num">{int(e.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
