let ambulanceKey = '';

export async function signInToCalls(key) {
  const url = process.env.EXPO_PUBLIC_CALL_URL;
  if (!url) throw new Error('C 서버 주소를 설정해 주세요.');
  const result = await fetch(url + '/access', { headers: { Authorization: 'Bearer ' + key } });
  if (!result.ok) throw new Error(result.status === 401 ? '구급대원 접근 키를 확인해 주세요.' : 'C 서버 연결을 확인해 주세요.');
  ambulanceKey = key;
}

export function clearCallAccess() {
  ambulanceKey = '';
}

function callFetch(url, options = {}) {
  return fetch(url, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + ambulanceKey } });
}

// Keep the exact payload and key until the create + detail sequence succeeds.
export function prepareCall(report, match) {
  return {
    key: Date.now() + '-' + Math.random().toString(36).slice(2),
    body: { report, hospitals: match.hospitals, appliedRadiusKm: match.meta?.appliedRadiusKm ?? match.appliedRadiusKm },
    callId: null,
  };
}

export async function loadCreatedCall(submission, signal) {
  const url = process.env.EXPO_PUBLIC_CALL_URL;
  if (!url) throw new Error('C 서버 주소(EXPO_PUBLIC_CALL_URL)를 설정해 주세요.');
  if (!submission.callId) {
    const response = await callFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': submission.key },
      body: JSON.stringify(submission.body),
      signal,
    });
    if (!response.ok) {
      const error = new Error(`호출 생성 실패 (HTTP ${response.status})`);
      error.creationRejected = response.status === 400 || response.status === 409;
      throw error;
    }
    const created = await response.json();
    if (!created.callId) throw new Error('생성된 호출 ID를 확인하지 못했습니다.');
    submission.callId = created.callId;
  }
  return fetchCallDetail(submission.callId, signal);
}

export async function fetchCallDetail(id, signal) {
  const response = await callFetch(process.env.EXPO_PUBLIC_CALL_URL + '/' + encodeURIComponent(id), { signal });
  if (!response.ok) throw new Error(`호출 상세 조회 실패 (HTTP ${response.status})`);
  return asCall(await response.json(), id);
}

const outcomes = { CONFIRMED: 'confirmed', ALL_DECLINED: 'declined', CANCELLED: 'cancelled' };

export async function fetchHistory(cursor, signal) {
  const query = '?status=terminal' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
  const response = await callFetch(process.env.EXPO_PUBLIC_CALL_URL + query, { signal });
  if (!response.ok) throw new Error(`기록 조회 실패 (HTTP ${response.status})`);
  const page = await response.json();
  return {
    records: page.records.map(r => ({
      id: r.callId, retryOf: r.retryOfCallId, outcome: outcomes[r.status], startedAt: r.startedAt, finishedAt: r.finishedAt,
      candidateCount: r.candidateCount, winner: r.confirmedHospitalName,
    })),
    nextCursor: page.nextCursor,
  };
}

export async function sendHospitalResponse(id, hpid, response, signal) {
  const url = process.env.EXPO_PUBLIC_CALL_URL + '/' + encodeURIComponent(id);
  const result = await callFetch(url + '/demo/hospitals/' + encodeURIComponent(hpid) + '/response', {
    signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: response === 'accepted' ? 'ACCEPT' : 'DECLINE' }),
  });
  if (!result.ok && result.status !== 409) throw new Error(`병원 응답 전송 실패 (HTTP ${result.status})`);
  return asCall(await result.json(), id);
}

export async function cancelCall(id) {
  const result = await callFetch(process.env.EXPO_PUBLIC_CALL_URL + '/' + encodeURIComponent(id) + '/cancel', { method: 'POST' });
  if (!result.ok && result.status !== 409) throw new Error(`호출 취소 실패 (HTTP ${result.status})`);
  return asCall(await result.json(), id);
}

export async function retryCall(id) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('재요청 응답을 10초 동안 받지 못했습니다.'));
      controller.abort();
    }, 10_000);
  });
  async function request() {
    const result = await callFetch(process.env.EXPO_PUBLIC_CALL_URL + '/' + encodeURIComponent(id) + '/retry', {
      method: 'POST', signal: controller.signal,
    });
    if (!result.ok) throw new Error(`재요청 실패 (HTTP ${result.status})`);
    const detail = await result.json();
    if (!detail.callId || detail.retryOfCallId !== id) throw new Error('재요청 결과를 확인하지 못했습니다.');
    return asCall(detail, detail.callId);
  }
  try {
    return await Promise.race([request(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function asCall(detail, id) {
  if (detail.callId !== id || !detail.report || !Array.isArray(detail.hospitals)) {
    throw new Error('호출 상세 응답을 확인하지 못했습니다.');
  }
  return {
    id: detail.callId, startedAt: Date.parse(detail.startedAt), retryOf: detail.retryOfCallId,
    finishedAt: detail.finishedAt ? Date.parse(detail.finishedAt) : null,
    outcome: outcomes[detail.status] ?? null,
    report: detail.report, appliedRadiusKm: detail.appliedRadiusKm,
    hospitals: detail.hospitals.map(h => ({
      ...h, status: h.status === 'CLOSED_BY_CONFIRMATION' ? 'closed' : h.status.toLowerCase(),
    })),
  };
}
