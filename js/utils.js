function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function today() { return new Date().toISOString().slice(0,10); }
function nowISO() { return new Date().toISOString(); }

function getWeekId(d = new Date()) {
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2,'0')}`;
}

function getWeekRange(weekId) {
  const [y, w] = weekId.split('-W').map(Number);
  const jan1 = new Date(y, 0, 1);
  const days = (w - 1) * 7;
  const start = new Date(jan1.getTime() + days * 86400000);
  start.setDate(start.getDate() - start.getDay() + 1);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const fmt = d => d.toLocaleDateString('es', {day:'numeric',month:'short'});
  return `${fmt(start)} — ${fmt(end)}`;
}

function getUpcomingWeeks(count = 6) {
  const weeks = [];
  const d = new Date();
  for (let i = 1; i <= count; i++) {
    const nd = new Date(d);
    nd.setDate(nd.getDate() + i * 7);
    const id = getWeekId(nd);
    if (!weeks.find(w => w.id === id)) weeks.push({ id, range: getWeekRange(id) });
  }
  return weeks;
}
