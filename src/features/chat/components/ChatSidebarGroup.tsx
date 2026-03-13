import { api } from '@convex/_generated/api';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from 'convex/react';
import { MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '~/components/ui/sidebar';
import { CHAT_ROUTE } from '~/features/chat/lib/constants';
import { toThreadId } from '~/features/chat/lib/ids';
import { useOptimisticThreads } from '~/features/chat/lib/optimistic-threads';
import { sortThreads } from '~/features/chat/lib/utils';

export function ChatSidebarGroup() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const threads = useQuery(api.agentChat.listThreads, {});
  const optimisticThreads = useOptimisticThreads();
  const renameThread = useMutation(api.agentChat.renameThread);
  const setThreadPinned = useMutation(api.agentChat.setThreadPinned);
  const deleteThread = useMutation(api.agentChat.deleteThread).withOptimisticUpdate(
    (localStore, args) => {
      const currentThreads = localStore.getQuery(api.agentChat.listThreads, {});
      if (!currentThreads) {
        return;
      }

      const remainingThreads = currentThreads.filter((thread) => thread._id !== args.threadId);

      localStore.setQuery(api.agentChat.listThreads, {}, remainingThreads);
      localStore.setQuery(api.agentChat.getThread, { threadId: args.threadId }, null);

      const currentLatestThreadId = localStore.getQuery(api.agentChat.getLatestThreadId, {});
      if (currentLatestThreadId === args.threadId) {
        localStore.setQuery(
          api.agentChat.getLatestThreadId,
          {},
          remainingThreads[0]?._id ?? null,
        );
      }
    },
  );
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renamingThreadId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingThreadId]);

  const sortedThreads = useMemo(() => {
    const serverThreads = threads ?? [];
    const serverThreadIds = new Set(
      serverThreads.map((thread: (typeof serverThreads)[number]) => thread._id),
    );

    return sortThreads([
      ...optimisticThreads.filter((thread: (typeof optimisticThreads)[number]) => !serverThreadIds.has(thread._id)),
      ...serverThreads,
    ]);
  }, [optimisticThreads, threads]);

  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const confirmRename = async () => {
    if (!renamingThreadId || !renameValue.trim()) {
      setRenamingThreadId(null);
      setRenameValue('');
      return;
    }

    await renameThread({ threadId: toThreadId(renamingThreadId), title: renameValue.trim() });
    setRenamingThreadId(null);
    setRenameValue('');
  };

  return (
    <SidebarGroup>
      <div className="flex items-center justify-between">
        <SidebarGroupLabel>Threads</SidebarGroupLabel>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() =>
            void navigate({
              to: CHAT_ROUTE,
              search: { new: true },
            })
          }
        >
          <Plus className="size-4" />
        </Button>
      </div>
      <SidebarGroupContent>
        <SidebarMenu>
          {sortedThreads.map((thread) => {
            const href = `/app/chat/${thread._id}`;
            const isActive = location.pathname === href;
            const isRenaming = renamingThreadId === thread._id;

            return (
              <SidebarMenuItem key={thread._id}>
                <SidebarMenuButton asChild isActive={isActive} tooltip={thread.title}>
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onBlur={() => {
                        void confirmRename();
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          void confirmRename();
                        }

                        if (event.key === 'Escape') {
                          setRenamingThreadId(null);
                          setRenameValue('');
                        }
                      }}
                      className="h-8 w-full rounded-md border border-border/60 bg-background px-2 text-sm outline-none"
                    />
                  ) : (
                    <Link
                      to="/app/chat/$threadId"
                      params={{ threadId: thread._id }}
                      onClick={closeMobileSidebar}
                    >
                      <span>{thread.title}</span>
                    </Link>
                  )}
                </SidebarMenuButton>
                {!isRenaming ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuAction showOnHover>
                        <MoreHorizontal className="size-4" />
                      </SidebarMenuAction>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem
                        onClick={() => {
                          setRenamingThreadId(thread._id);
                          setRenameValue(thread.title);
                        }}
                      >
                        <Pencil className="size-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          void setThreadPinned({ threadId: thread._id, pinned: !thread.pinned })
                        }
                      >
                        {thread.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                        {thread.pinned ? 'Unpin' : 'Pin'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => {
                          const remaining = sortedThreads.filter((item) => item._id !== thread._id);
                          void deleteThread({ threadId: thread._id }).then(() => {
                            if (location.pathname === href) {
                              const nextThread = remaining[0];
                              if (nextThread) {
                                void navigate({
                                  to: '/app/chat/$threadId',
                                  params: { threadId: nextThread._id },
                                });
                              } else {
                                void navigate({ to: CHAT_ROUTE });
                              }
                            }
                          });
                        }}
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
