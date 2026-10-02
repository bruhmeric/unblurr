"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Search, Crown, User, RefreshCw, Trash2, RotateCcw, ChevronLeft, ChevronRight, ShieldCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import type { EnrichedUser } from "@/lib/types";
import { fmtDate } from "./format";

const PAGE_SIZE = 10;

export function UsersTab({ onChanged }: { onChanged?: () => void }) {
  const { toast } = useToast();
  const [users, setUsers] = useState<EnrichedUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (p: number, q: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/users?page=${p}&pageSize=${PAGE_SIZE}&search=${encodeURIComponent(q)}`,
        { cache: "no-store" }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setUsers(data.users || []);
        setTotal(data.total || 0);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(1, ""); }, [load]);

  const onSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(1);
      load(1, value);
    }, 300);
  };

  const setPlan = useCallback(async (user: EnrichedUser, plan: "free" | "premium") => {
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, plan } : u)));
        toast({
          title: plan === "premium" ? "Premium granted" : "Reverted to free",
          description: `${user.email} is now on the ${plan} plan.`,
        });
        onChanged?.();
      } else {
        toast({ title: "Update failed", description: data.error, variant: "destructive" });
      }
    } finally {
      setBusyId(null);
    }
  }, [toast, onChanged]);

  const resetUsage = useCallback(async (user: EnrichedUser) => {
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-usage" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({
          title: "Daily usage reset",
          description: `${data.removed || 0} record(s) removed for ${user.email}.`,
        });
        load(page, search);
      } else {
        toast({ title: "Reset failed", description: data.error, variant: "destructive" });
      }
    } finally {
      setBusyId(null);
    }
  }, [toast, load, page, search]);

  const deleteUser = useCallback(async (user: EnrichedUser) => {
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "User deleted", description: `${user.email} and their history were removed.` });
        onChanged?.();
        if (users.length === 1 && page > 1) {
          setPage(page - 1);
          load(page - 1, search);
        } else {
          load(page, search);
        }
      } else {
        toast({ title: "Delete failed", description: data.error, variant: "destructive" });
      }
    } finally {
      setBusyId(null);
    }
  }, [toast, load, page, search, users.length, onChanged]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
          <Input
            placeholder="Search by email or name…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="h-10 pl-9 border-white/10 bg-white/[0.03] text-zinc-100 placeholder:text-zinc-600"
          />
        </div>
        <p className="text-xs text-zinc-500">{total} user{total === 1 ? "" : "s"} total</p>
      </div>

      <Card className="border-white/10 bg-[#0b0f11]/80 backdrop-blur">
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : users.length === 0 ? (
            <div className="p-10 text-center text-sm text-zinc-500">No users found.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-zinc-500">User</TableHead>
                    <TableHead className="text-zinc-500">Plan</TableHead>
                    <TableHead className="text-zinc-500">Status</TableHead>
                    <TableHead className="text-zinc-500 text-center">Today</TableHead>
                    <TableHead className="text-zinc-500 text-center">All-time</TableHead>
                    <TableHead className="text-zinc-500">Joined</TableHead>
                    <TableHead className="text-zinc-500 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => {
                    const unlimited = u.role === "admin" || u.plan === "premium";
                    const busy = busyId === u.id;
                    return (
                      <TableRow key={u.id} className="border-white/5">
                        <TableCell>
                          <div className="flex items-center gap-2.5 min-w-0">
                            {u.role === "admin" && <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />}
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-zinc-200">{u.email}</div>
                              {u.name && <div className="truncate text-xs text-zinc-500">{u.name}</div>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {u.role === "admin" ? (
                            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">admin</Badge>
                          ) : u.plan === "premium" ? (
                            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400">
                              <Crown className="mr-1 h-3 w-3" />premium
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-white/10 bg-white/5 text-zinc-400">free</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {u.emailVerified ? (
                            <span className="text-xs text-emerald-400">verified</span>
                          ) : (
                            <span className="text-xs text-amber-400">pending</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center text-sm text-zinc-300">
                          {unlimited ? "∞" : `${u.videosToday}/2`}
                        </TableCell>
                        <TableCell className="text-center text-sm text-zinc-300">{u.videosTotal}</TableCell>
                        <TableCell className="text-xs text-zinc-500">{fmtDate(u.createdAt)}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5">
                            {u.role !== "admin" && (
                              <>
                                {u.plan === "premium" ? (
                                  <Button
                                    variant="outline" size="sm" disabled={busy}
                                    onClick={() => setPlan(u, "free")}
                                    title="Revert to free"
                                    className="h-8 border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
                                  >
                                    <User className="h-3.5 w-3.5" />
                                    <span className="ml-1.5 hidden xl:inline">Make free</span>
                                  </Button>
                                ) : (
                                  <Button
                                    variant="outline" size="sm" disabled={busy}
                                    onClick={() => setPlan(u, "premium")}
                                    title="Grant premium (unlimited videos)"
                                    className="h-8 border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                                  >
                                    <Crown className="h-3.5 w-3.5" />
                                    <span className="ml-1.5 hidden xl:inline">Make premium</span>
                                  </Button>
                                )}
                                <Button
                                  variant="outline" size="sm" disabled={busy}
                                  onClick={() => resetUsage(u)}
                                  title="Reset today's video count"
                                  className="h-8 border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="outline" size="sm" disabled={busy}
                                      title="Delete user"
                                      className="h-8 border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent className="border-white/10 bg-[#0b0f11] text-zinc-100">
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete {u.email}?</AlertDialogTitle>
                                      <AlertDialogDescription className="text-zinc-400">
                                        This permanently removes the account and all processing history.
                                        This action cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel className="border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white">Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => deleteUser(u)}
                                        className="bg-red-500 text-white hover:bg-red-400"
                                      >
                                        Delete user
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-white/5 px-4 py-3">
              <p className="text-xs text-zinc-500">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline" size="sm" disabled={page <= 1 || loading}
                  onClick={() => { const p = page - 1; setPage(p); load(p, search); }}
                  className="h-8 border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline" size="sm" disabled={page >= totalPages || loading}
                  onClick={() => { const p = page + 1; setPage(p); load(p, search); }}
                  className="h-8 border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-zinc-600 flex items-center gap-1.5">
        <RefreshCw className="h-3 w-3" />
        Usage counters reset daily at 00:00 UTC. Premium &amp; admin accounts have unlimited processing.
      </p>
    </div>
  );
}
