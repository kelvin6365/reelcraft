"use client";
import { int } from "./format";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// ⑤ 錯誤 top — errorCode 次數排行。
export function ErrorTop({ errors }: { errors: { errorCode: string; count: number }[] }) {
  if (errors.length === 0) return <p className="text-sm text-muted-foreground">此區間內未有錯誤。</p>;
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>錯誤代碼</TableHead>
            <TableHead className="text-right">次數</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {errors.map((e) => (
            <TableRow key={e.errorCode}>
              <TableCell className="font-medium">{e.errorCode}</TableCell>
              <TableCell className="text-right tabular-nums">{int(e.count)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
