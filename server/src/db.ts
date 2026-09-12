import { Pool } from 'pg'

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://repair:repair@localhost:5432/repair',
  max: 10,
})

export async function q(text: string, params?: any[]) {
  return pool.query(text, params)
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  phone TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS technicians(
  user_id INT PRIMARY KEY REFERENCES users(id),
  skills JSONB DEFAULT '[]',
  high_altitude_cert BOOLEAN DEFAULT false,
  community TEXT DEFAULT '',
  lat DOUBLE PRECISION DEFAULT 0,
  lng DOUBLE PRECISION DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS parts(
  id SERIAL PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  device_type TEXT NOT NULL,
  brands JSONB DEFAULT '[]',
  faults JSONB DEFAULT '[]',
  stock INT DEFAULT 0,
  price_cents INT DEFAULT 0,
  batch_no TEXT DEFAULT '',
  supplier TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders(
  id SERIAL PRIMARY KEY,
  order_no TEXT UNIQUE NOT NULL,
  resident_id INT REFERENCES users(id),
  device_type TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT DEFAULT '',
  fault_type TEXT DEFAULT '',
  fault_desc TEXT DEFAULT '',
  purchase_years INT DEFAULT 0,
  floor INT DEFAULT 1,
  has_elevator BOOLEAN DEFAULT false,
  community TEXT DEFAULT '',
  address TEXT DEFAULT '',
  lat DOUBLE PRECISION DEFAULT 0,
  lng DOUBLE PRECISION DEFAULT 0,
  time_slots JSONB DEFAULT '[]',
  status TEXT DEFAULT 'pending',
  technician_id INT REFERENCES users(id),
  scheduled_date TEXT DEFAULT '',
  scheduled_slot TEXT DEFAULT '',
  safety_risk TEXT DEFAULT 'low',
  original_order_id INT REFERENCES orders(id),
  is_warranty_rework BOOLEAN DEFAULT false,
  fee_adjust_cents INT DEFAULT 0,
  fee_note TEXT DEFAULT '',
  test_result TEXT DEFAULT '',
  test_note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_events(
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  actor_id INT,
  actor_name TEXT DEFAULT '',
  actor_role TEXT DEFAULT '',
  action TEXT NOT NULL,
  detail JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS evidence(
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  stage TEXT NOT NULL,
  file_path TEXT NOT NULL,
  note TEXT DEFAULT '',
  uploaded_by INT,
  uploaded_by_name TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS quotes(
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  version INT DEFAULT 1,
  status TEXT DEFAULT 'pending',
  items JSONB DEFAULT '[]',
  total_cents INT DEFAULT 0,
  remark TEXT DEFAULT '',
  created_by INT,
  created_by_name TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  confirmed_by TEXT DEFAULT '',
  confirmed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS order_parts(
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  part_id INT REFERENCES parts(id),
  qty INT DEFAULT 1,
  status TEXT DEFAULT 'reserved',
  batch_no TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS exceptions(
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  type TEXT NOT NULL,
  title TEXT DEFAULT '',
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'open',
  created_by INT,
  created_by_name TEXT DEFAULT '',
  created_by_role TEXT DEFAULT '',
  handler_id INT,
  handler_name TEXT DEFAULT '',
  resolution TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS payments(
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  amount_cents INT DEFAULT 0,
  method TEXT DEFAULT 'online',
  status TEXT DEFAULT 'paid',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reviews(
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  rating INT DEFAULT 5,
  tags JSONB DEFAULT '[]',
  comment TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS warranties(
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  period_days INT DEFAULT 90,
  start_date TEXT DEFAULT '',
  end_date TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS schedule(
  id SERIAL PRIMARY KEY,
  technician_id INT REFERENCES users(id),
  date TEXT NOT NULL,
  slot TEXT NOT NULL,
  order_id INT REFERENCES orders(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(technician_id, date, slot, order_id)
);
`

export async function initDb() {
  // 等待数据库就绪（compose 内 db 先健康检查，这里再做兜底重试）
  let lastErr: any = null
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query('SELECT 1')
      lastErr = null
      break
    } catch (e) {
      lastErr = e
      await new Promise(r => setTimeout(r, 1000))
    }
  }
  if (lastErr) throw lastErr
  await pool.query(SCHEMA)
}

/** 记录订单事件（时间线 / 档案还原的数据基础） */
export async function logEvent(
  orderId: number,
  actor: { id?: number; name?: string; role?: string } | null,
  action: string,
  detail: any = {}
) {
  await q(
    `INSERT INTO order_events(order_id, actor_id, actor_name, actor_role, action, detail) VALUES($1,$2,$3,$4,$5,$6)`,
    [orderId, actor?.id ?? null, actor?.name ?? '系统', actor?.role ?? 'system', action, JSON.stringify(detail)]
  )
}

export async function touchOrder(orderId: number) {
  await q(`UPDATE orders SET updated_at = now() WHERE id = $1`, [orderId])
}

/** 配件可用库存 = 实物库存 - 已预留/已出库数量 */
export async function partAvailability(partId: number): Promise<number> {
  const p = await q(`SELECT stock FROM parts WHERE id = $1`, [partId])
  if (!p.rows.length) return 0
  const r = await q(
    `SELECT COALESCE(SUM(qty),0)::int AS held FROM order_parts WHERE part_id = $1 AND status IN ('reserved','outbound')`,
    [partId]
  )
  return p.rows[0].stock - r.rows[0].held
}

export async function partsAvailabilityMap(): Promise<Map<number, number>> {
  const r = await q(`
    SELECT p.id, p.stock - COALESCE(h.held,0)::int AS available
    FROM parts p
    LEFT JOIN (
      SELECT part_id, SUM(qty)::int AS held FROM order_parts WHERE status IN ('reserved','outbound') GROUP BY part_id
    ) h ON h.part_id = p.id
  `)
  const m = new Map<number, number>()
  for (const row of r.rows) m.set(row.id, row.available)
  return m
}
