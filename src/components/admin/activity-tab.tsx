"use client";

import { useCallback, useEffect, useState } from "react";
import { Film, Mail, ChevronLeft, ChevronRight, Inbox, PlayCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { fmtBytes, fmtDate } from "./format";

const PAGE_SIZE = 20;

interface ProcessingRow { id: string; email?: string; fileName: string; fileSize: number; createdAt: string }
interface EmailRow { id: string; to: string; subject: string; kind: string; status: string; error?: string; createdAt: string }

export function ActivityTab() {
  const [kind, setKind] = useState<"processing" | "email">("processing");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [processing, setProcessing] = useState<ProcessingRow[]>([]);
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (k: "processing" | "email", p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/logs?kind=${k}&page=${p}&pageSize=${PAGE_SIZE}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTotal(data.total || 0);
        if (k === "email") setEmails(data.logs || []);
        else setProcessing(data.logs || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(kind, 1); setPage(1); }, [kind, load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const go = (p: number) => { setPage(p); load(kind, p); };

  return (
    <div className="space-y-4">
      <Tabs value={kind} onValueChange={(v) => setKind(v as "processing" | "email")}>
        <TabsList className="bg-white/5 border border-white/10">
          <TabsTrigger value="processing" className="data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-300 text-zinc-400">
            <PlayCircle className="mr-1.5 h-4 w-4" /> Video history
          </TabsTrigger>
          <TabsTrigger value="email" className="data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-300 text-zinc-400">
            <Inbox className="mr-1.5 h-4 w-4" /> Email log
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="border-white/10 bg-[#0b0f11]/80 backdrop-blur">
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              {kind === "processing" ? (
                processing.length === 0 ? (
                  <EmptyState icon={Film} text="No videos have been processed yet." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/10 hover:bg-transparent">
                        <TableHead className="text-zinc-500">User</TableHead>
                        <TableHead className="text-zinc-500">File</TableHead>
                        <TableHead className="text-zinc-500">Size</TableHead>
                        <TableHead className="text-zinc-500">Processed at</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {processing.map((l) => (
                        <TableRow key={l.id} className="border-white/5">
                          <TableCell className="text-sm text-zinc-300">{l.email}</TableCell>
                          <TableCell className="max-w-[220px] truncate text-sm text-zinc-400">{l.fileName}</TableCell>
                          <TableCell className="text-sm text-zinc-400">{fmtBytes(l.fileSize)}</TableCell>
                          <TableCell className="text-xs text-zinc-500">{fmtDate(l.createdAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )
              ) : emails.length === 0 ? (
                <EmptyState icon={Mail} text="No emails have been sent yet." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/10 hover:bg-transparent">
                      <TableHead className="text-zinc-500">To</TableHead>
                      <TableHead className="text-zinc-500">Subject</TableHead>
                      <TableHead className="text-zinc-500">Status</TableHead>
                      <TableHead className="text-zinc-500">Sent at</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {emails.map((l) => (
                      <TableRow key={l.id} className="border-white/5">
                        <TableCell className="text-sm text-zinc-300">{l.to}</TableCell>
                        <TableCell className="max-w-[240px] truncate text-sm text-zinc-400">{l.subject}</TableCell>
                        <TableCell>
                          {l.status === "sent" ? (
                            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">sent</Badge>
                          ) : l.status === "failed" ? (
                            <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-400" title={l.error}>failed</Badge>
                          ) : (
                            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400" title="RESEND_API_KEY not configured">skipped</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-zinc-500">{fmtDate(l.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-white/5 px-4 py-3">
              <p className="text-xs text-zinc-500">Page {page} of {totalPages} · {total} records</p>
              <div className="flex gap-2">
                <Button
                  variant="outline" size="sm" disabled={page <= 1 || loading}
                  onClick={() => go(page - 1)}
                  className="h-8 border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline" size="sm" disabled={page >= totalPages || loading}
                  onClick={() => go(page + 1)}
                  className="h-8 border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center">
      <Icon className="h-8 w-8 text-zinc-700" />
      <p className="text-sm text-zinc-500">{text}</p>
    </div>
  );
}
