import type { Order, OrderItem, OrderRepository, OrderStatus } from "../../core/index";
import { iso } from "./dates";

type OrderRow = {
  id: string;
  comprador_nombre: string;
  comprador_direccion: string;
  entrega_para: string | null;
  entrega_tipo: "envio" | "retiro" | null;
  nota: string;
  medio_de_pago: Order["paymentMethod"];
  items: string;
  total_monto: number;
  total_moneda: string;
  estado: OrderStatus;
  creado_en: string;
  actualizado_en: string;
};

// `items` is a JSON snapshot with English keys: only this repository writes and reads it.
const toOrder = (r: OrderRow): Order => ({
  id: r.id,
  // Core validated the items when the order was placed.
  items: JSON.parse(r.items) as OrderItem[],
  buyer: { name: r.comprador_nombre, address: r.comprador_direccion },
  paymentMethod: r.medio_de_pago,
  total: { amount: r.total_monto, currency: r.total_moneda as Order["total"]["currency"] },
  status: r.estado,
  note: r.nota,
  ...(r.entrega_para && r.entrega_tipo ? { scheduled: { for: r.entrega_para, fulfillment: r.entrega_tipo } } : {}),
  createdByAgent: false,
  createdAt: new Date(r.creado_en),
  updatedAt: new Date(r.actualizado_en),
});

export function createD1OrderRepository(db: D1Database): OrderRepository {
  return {
    async insert(o) {
      await db
        .prepare(
          `INSERT INTO pedidos (id, comprador_nombre, comprador_direccion, nota, medio_de_pago, items, total_monto, total_moneda, estado, creado_en, actualizado_en, entrega_para, entrega_tipo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          o.id,
          o.buyer.name,
          o.buyer.address,
          o.note,
          o.paymentMethod,
          JSON.stringify(o.items),
          o.total.amount,
          o.total.currency,
          o.status,
          iso(o.createdAt),
          iso(o.updatedAt),
          o.scheduled?.for ?? null,
          o.scheduled?.fulfillment ?? null,
        )
        .run();
    },

    async list() {
      const { results } = await db
        .prepare(
          "SELECT * FROM pedidos ORDER BY CASE estado WHEN 'entregado' THEN 1 WHEN 'cancelado' THEN 1 ELSE 0 END, creado_en DESC",
        )
        .all<OrderRow>();
      return results.map(toOrder);
    },

    async findById(id) {
      const row = await db.prepare("SELECT * FROM pedidos WHERE id = ?").bind(id).first<OrderRow>();
      return row === null ? null : toOrder(row);
    },

    async updateStatus(id, status, updatedAt) {
      await db
        .prepare("UPDATE pedidos SET estado = ?, actualizado_en = ? WHERE id = ?")
        .bind(status, iso(updatedAt), id)
        .run();
    },
  };
}
