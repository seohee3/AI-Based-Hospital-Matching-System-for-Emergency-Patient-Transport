import React, { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { Box, Btn, Header, Screen, s } from '../ui';
import ReportSummary from '../ReportSummary';
import { fetchCallDetail, fetchHistory } from '../callApi';
import { outcomeText, statusText } from '../callResponses';

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
      {records.map(record => {
        const open = expanded === record.id;
        return (
          <Box key={record.id}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
              onPress={() => setExpanded(open ? null : record.id)}>
              <Text style={s.small}>{new Date(record.finishedAt).toLocaleString()} 종료</Text>
              <Text style={s.h2}>{record.retryOf ? '재요청' : '최초 호출'} · {outcomeText[record.outcome]}{record.winner && ' · ' + record.winner}</Text>
              <Text style={s.value}>후보 {record.candidateCount}곳 · {open ? '상세 접기' : '상세 보기'}</Text>
            </Pressable>
            {open && <RecordDetail id={record.id} />}
          </Box>
        );
      })}
      {loading && <Text style={s.value}>기록 불러오는 중…</Text>}
      {error && <Btn title="기록 조회 실패 · 다시 조회" onPress={() => setAttempt(n => n + 1)} />}
      {!loading && !error && nextCursor && <Btn title="이전 기록 더 보기" onPress={() => setCursor(nextCursor)} />}
    </Screen>
  );
}
