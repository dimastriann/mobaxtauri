import { useState } from 'react';
import { Flex, Box, Text, Grid, Input, Icon, Button } from '@chakra-ui/react';
import { LuTerminal, LuServer, LuCode, LuStar, LuClock, LuZap, LuFolder } from 'react-icons/lu';
import { Session, Folder, useSessionStore } from '../store/useSessionStore';
import OSIcon from './OSIcon';

interface DashboardProps {
  onQuickConnect: (str: string) => void;
  onConnectSession: (session: Session) => void;
}

export default function Dashboard({ onQuickConnect, onConnectSession }: DashboardProps) {
  const sessions = useSessionStore((state) => state.sessions);
  const snippets = useSessionStore((state) => state.snippets);
  const updateSession = useSessionStore((state) => state.updateSession);
  const folders = useSessionStore((state) => state.folders);

  const [quickConnectStr, setQuickConnectStr] = useState('');

  const handleQuickConnect = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && quickConnectStr.trim() !== '') {
      onQuickConnect(quickConnectStr);
      setQuickConnectStr('');
    }
  };

  const activeSessionsCount = sessions.filter((s) => s.status === 'connected').length;
  const sshSessions = sessions.filter((s) => s.type === 'ssh');

  const prodCount = sshSessions.filter((s) => s.tag === 'prod').length;
  const stagingCount = sshSessions.filter((s) => s.tag === 'staging').length;
  const devCount = sshSessions.filter((s) => s.tag === 'dev').length;

  // Sort by favorite first, then by lastActivity
  const recentSessions = [...sshSessions]
    .sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return (b.lastActivity || 0) - (a.lastActivity || 0);
    })
    .slice(0, 8); // Top 8

  return (
    <Flex
      direction="column"
      flex={1}
      minH={0}
      bg="bg.panel"
      color="fg"
      p={5}
      overflowY="auto"
      className="custom-scrollbar"
    >
      {/* Header */}
      <Flex direction="column" mb={6}>
        <Text
          fontSize="4xl"
          fontWeight="bold"
          letterSpacing="tight"
          style={{
            backgroundImage: 'linear-gradient(to right, #60a5fa, #c084fc)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          Welcome back
        </Text>
        <Text color="fg.muted" fontSize="lg" mt={2}>
          Manage your infrastructure, connections, and snippets from one place.
        </Text>
      </Flex>

      {/* Quick Connect Widget */}
      <Box
        mb={5}
        p={4}
        bg="bg.surface"
        borderRadius="xl"
        border="1px solid"
        borderColor="border.subtle"
        boxShadow="sm"
      >
        <Flex align="center" mb={4}>
          <Icon as={LuZap} color="yellow.400" boxSize={5} mr={2} />
          <Text fontSize="lg" fontWeight="semibold">
            Quick Connect
          </Text>
        </Flex>
        <Flex gap={4}>
          <Input
            placeholder="user@host:port (Press Enter to connect)"
            size="lg"
            variant="subtle"
            value={quickConnectStr}
            onChange={(e) => setQuickConnectStr(e.target.value)}
            onKeyDown={handleQuickConnect}
            flex={1}
            borderRadius="lg"
            bg="bg.muted"
            _focus={{ bg: 'bg.panel', borderColor: 'brand.500' }}
          />
          <Button
            colorPalette="brand"
            size="lg"
            px={8}
            onClick={() => {
              if (quickConnectStr.trim()) {
                onQuickConnect(quickConnectStr);
                setQuickConnectStr('');
              }
            }}
          >
            Connect
          </Button>
        </Flex>
      </Box>

      <Flex direction={{ base: 'column-reverse', '2xl': 'row' }} gap={5} align="flex-start">
        {/* Left Column (Folders, Recent) */}
        <Flex direction="column" flex={1} w="100%" gap={5}>
          {/* Folders */}
          <Box
            p={4}
            bg="bg.surface"
            borderRadius="xl"
            border="1px solid"
            borderColor="border.subtle"
          >
            <Flex justify="space-between" align="center" mb={4}>
              <Text fontSize="lg" fontWeight="semibold">
                Folders ({folders.length})
              </Text>
              <Icon as={LuFolder} color="fg.muted" boxSize={5} />
            </Flex>
            <Grid templateColumns="repeat(auto-fill, minmax(180px, 1fr))" gap={4}>
              {folders.map((f: Folder) => {
                const count = sessions.filter((s) => s.folderId === f.id).length;
                return (
                  <Flex
                    key={f.id}
                    p={3}
                    bg="bg.muted"
                    borderRadius="lg"
                    border="1px solid"
                    borderColor="border.subtle"
                    align="center"
                    _hover={{
                      borderColor: 'brand.500',
                      transform: 'translateY(-1px)',
                      boxShadow: 'sm',
                      cursor: 'pointer',
                    }}
                    transition="all 0.2s"
                  >
                    <Icon as={LuFolder} color="brand.500" mr={3} boxSize={5} />
                    <Flex direction="column" flex={1} overflow="hidden">
                      <Text fontWeight="medium" fontSize="sm" lineClamp={1}>
                        {f.name}
                      </Text>
                      <Text fontSize="xs" color="fg.muted">
                        {count} host{count !== 1 ? 's' : ''}
                      </Text>
                    </Flex>
                  </Flex>
                );
              })}
              {folders.length === 0 && (
                <Text color="fg.muted" fontSize="sm">
                  No folders created yet.
                </Text>
              )}
            </Grid>
          </Box>

          {/* Recent & Favorites */}
          <Flex direction="column">
            <Flex align="center" mb={4}>
              <Icon as={LuClock} color="fg.muted" boxSize={5} mr={2} />
              <Text fontSize="xl" fontWeight="semibold">
                Recent & Favorites
              </Text>
            </Flex>

            {recentSessions.length === 0 ? (
              <Flex
                align="center"
                justify="center"
                p={10}
                border="1px dashed"
                borderColor="border.subtle"
                borderRadius="xl"
              >
                <Text color="fg.muted">
                  No recent sessions found. Connect to a host to see it here.
                </Text>
              </Flex>
            ) : (
              <Grid
                templateColumns={{ base: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }}
                gap={4}
              >
                {recentSessions.map((session) => (
                  <Box
                    key={session.id}
                    p={4}
                    bg="bg.surface"
                    borderRadius="xl"
                    border="1px solid"
                    borderColor="border.subtle"
                    transition="all 0.2s"
                    _hover={{
                      borderColor: 'brand.500',
                      transform: 'translateY(-2px)',
                      boxShadow: 'md',
                      cursor: 'pointer',
                    }}
                    onClick={() => onConnectSession(session)}
                    position="relative"
                    overflow="hidden"
                  >
                    <Flex justify="space-between" align="flex-start" mb={3}>
                      <Flex
                        w={10}
                        h={10}
                        borderRadius="lg"
                        bg="bg.muted"
                        align="center"
                        justify="center"
                        color={session.status === 'connected' ? 'green.400' : 'fg.muted'}
                      >
                        <OSIcon os={session.os} boxSize={5} />
                      </Flex>
                    </Flex>
                    <Text fontWeight="medium" fontSize="md" lineClamp={1} mb={1}>
                      {session.name}
                    </Text>
                    <Text fontSize="sm" color="fg.muted" lineClamp={1}>
                      {session.user}@{session.host}
                    </Text>

                    <Flex justify="space-between" align="center" mt={3}>
                      <Text fontSize="xs" color="fg.muted">
                        Port {session.port}
                      </Text>
                      <Icon
                        as={LuStar}
                        boxSize={5}
                        color={session.isFavorite ? 'yellow.400' : 'border.subtle'}
                        cursor="pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateSession(session.id, { isFavorite: !session.isFavorite });
                        }}
                        _hover={{ color: 'yellow.400' }}
                      />
                    </Flex>

                    {session.tag && (
                      <Box
                        position="absolute"
                        top="12px"
                        right="-24px"
                        bg={
                          session.tag === 'prod'
                            ? 'red.500'
                            : session.tag === 'staging'
                              ? 'orange.500'
                              : session.tag === 'dev'
                                ? 'green.500'
                                : 'gray.500'
                        }
                        color="white"
                        fontSize="9px"
                        fontWeight="bold"
                        textTransform="uppercase"
                        py={0.5}
                        w="90px"
                        textAlign="center"
                        transform="rotate(45deg)"
                        boxShadow="sm"
                      >
                        {session.tag}
                      </Box>
                    )}
                  </Box>
                ))}
              </Grid>
            )}
          </Flex>
        </Flex>

        {/* Right Column (Stats & Env) */}
        <Flex direction="column" w={{ base: '100%', '2xl': '350px' }} gap={4}>
          {/* Stats Grid */}
          <Grid
            templateColumns={{
              base: '1fr',
              md: 'repeat(3, 1fr)',
              '2xl': '1fr',
            }}
            gap={4}
          >
            <StatCard
              icon={LuServer}
              title="Total Hosts"
              value={sshSessions.length.toString()}
              color="blue"
            />
            <StatCard
              icon={LuTerminal}
              title="Active Sessions"
              value={activeSessionsCount.toString()}
              color="green"
            />
            <StatCard
              icon={LuCode}
              title="Saved Snippets"
              value={snippets.length.toString()}
              color="purple"
            />
          </Grid>

          {/* Environments Grid */}
          <Grid
            templateColumns={{
              base: '1fr',
              md: 'repeat(3, 1fr)',
              '2xl': '1fr',
            }}
            gap={4}
          >
            <StatCard icon={LuServer} title="Production" value={prodCount.toString()} color="red" />
            <StatCard
              icon={LuServer}
              title="Staging"
              value={stagingCount.toString()}
              color="orange"
            />
            <StatCard
              icon={LuServer}
              title="Development"
              value={devCount.toString()}
              color="green"
            />
          </Grid>
        </Flex>
      </Flex>
    </Flex>
  );
}

function StatCard({
  icon,
  title,
  value,
  color,
}: {
  icon: any;
  title: string;
  value: string;
  color: string;
}) {
  return (
    <Flex
      p={4}
      bg="bg.surface"
      borderRadius="xl"
      border="1px solid"
      borderColor="border.subtle"
      align="center"
    >
      <Box position="relative" w={14} h={14} mr={4}>
        <Flex
          w="100%"
          h="100%"
          borderRadius="xl"
          bg={`${color}.500`}
          opacity={0.1}
          position="absolute"
        />
        <Flex
          w="100%"
          h="100%"
          borderRadius="xl"
          align="center"
          justify="center"
          color={`${color}.500`}
          position="absolute"
        >
          <Icon as={icon} boxSize={6} />
        </Flex>
      </Box>
      <Flex direction="column">
        <Text color="fg.muted" fontSize="sm" fontWeight="medium">
          {title}
        </Text>
        <Text fontSize="2xl" fontWeight="bold">
          {value}
        </Text>
      </Flex>
    </Flex>
  );
}
