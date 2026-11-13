import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Box, Btn, Header, Screen, s } from '../ui';
import ReportSummary from '../ReportSummary';
import { fetchCallDetail, fetchHistory } from '../callApi';
import { outcomeText, statusText } from '../callResponses';
import { C } from '../theme';

const tagColors = ['#4468AE', '#307A75', '#795998', '#976037'];

function groupByOriginalCall(records) {
  const parents = new Map(records.map(record => [record.id, record.retryOf]));
  const roots = new Map();
  const groups = new Map();
  for (const record of records) {
    let id = record.id;
    const path = [];
    while (parents.get(id) && !roots.has(id)) {
      path.push(id);
      id = parents.get(id);
    }
    const root = roots.get(id) ?? id;
    for (const step of path) roots.set(step, root);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(record);
  }
  return [...groups.values()];
}

function RecordDetail({ id }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    setError(false);
    fetchCallDetail(id, request.signal).then(result => {
      if (!request.signal.aborted) setDetail(result);
    }).catch(() => { if (!request.signal.aborted) setError(true); });
    return () => request.abort();
  }, [id, attempt]);
  if (error) return <Btn title="상세 조회 실패 · 다시 조회" onPress={() => setAttempt(n => n + 1)} />;
  if (!detail) return <Text style={s.value}>상세 불러오는 중…</Text>;
  return <>
    <Text style={s.value}>호출 시각 {new Date(detail.startedAt).toLocaleString()}</Text>
    {detail.hospitals.map(h => <Text key={h.hpid} style={s.value}>
      {h.rank}순위 {h.dutyName} · {statusText[h.status]}{h.respondedAt && ' · ' + new Date(h.respondedAt).toLocaleTimeString()}
    </Text>)}
    <ReportSummary report={detail.report} showNotes />
  </>;
}

export default function History({ onBack }) {
  const [records, setRecords] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const groups = useMemo(() => groupByOriginalCall(records), [records]);
  useEffect(() => {
    const request = new AbortController();
    setLoading(true);
    setError(false);
    fetchHistory(cursor, request.signal).then(page => {
      if (request.signal.aborted) return;
      setRecords(previous => cursor ? [...previous, ...page.records] : page.records);
      setNextCursor(page.nextCursor);
    }).catch(() => { if (!request.signal.aborted) setError(true); })
      .finally(() => { if (!request.signal.aborted) setLoading(false); });
    return () => request.abort();
  }, [cursor, attempt]);
  return (
    <Screen>
      <Header title="지난 이송 기록" onBack={onBack} />
      {!loading && !error && records.length === 0 && <Text style={s.value}>아직 종료된 호출이 없습니다.</Text>}
      {groups.map((group, index) => (
        <Box key={group[0].id} style={styles.group}>
          <View style={styles.heading}>
            <View style={[styles.dot, { backgroundColor: tagColors[index % tagColors.length] }]} />
            <Text style={styles.groupTitle}>이송 건 {index + 1}</Text>
          </View>
          {group.map(record => {
            const open = expanded === record.id;
            return (
              <View key={record.id} style={styles.record}>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
                  onPress={() => setExpanded(open ? null : record.id)}>
                  <Text style={s.small}>{new Date(record.finishedAt).toLocaleString()} 종료</Text>
                  <Text style={s.h2}>{record.retryOf ? '재요청' : '최초 호출'} · {outcomeText[record.outcome]}{record.winner && ' · ' + record.winner}</Text>
                  <Text style={s.value}>후보 {record.candidateCount}곳 · {open ? '상세 접기' : '상세 보기'}</Text>
                </Pressable>
                {open && <RecordDetail id={record.id} />}
              </View>
            );
          })}
        </Box>
      ))}
      {loading && <Text style={s.value}>기록 불러오는 중…</Text>}
      {error && <Btn title="기록 조회 실패 · 다시 조회" onPress={() => setAttempt(n => n + 1)} />}
      {!loading && !error && nextCursor && <Btn title="이전 기록 더 보기" onPress={() => setCursor(nextCursor)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { paddingHorizontal: 16 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  groupTitle: { fontSize: 14, fontWeight: '700', color: C.ink },
  record: { marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.gray },
});
