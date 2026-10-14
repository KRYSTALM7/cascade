/**
 * Action Catalogue — comprehensive guide for first-time users and judges.
 * Derived from backend tool definitions (backend/app/domain/tools/) and seed data.
 */

export interface ActionParameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
  example?: string;
  constraints?: string;
}

export interface ActionDefinition {
  id: string;
  name: string;
  agent: string;
  category: string;
  description: string;
  parameters: ActionParameter[];
  examples: string[];
  restrictions?: string[];
  reversibility: 'FULL' | 'PARTIAL' | 'NONE';
  impact: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  readOnly?: boolean;
}

export interface ActionCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export const ACTION_CATEGORIES: ActionCategory[] = [
  {
    id: 'orders',
    name: 'Orders',
    description: 'View, cancel, modify, and update order lifecycle',
    icon: '📦',
  },
  {
    id: 'finance',
    name: 'Finance',
    description: 'Refunds, compensation, and payment operations',
    icon: '💰',
  },
  {
    id: 'inventory',
    name: 'Inventory',
    description: 'Reserve, release, and restock products',
    icon: '📊',
  },
  {
    id: 'crm',
    name: 'CRM',
    description: 'Customer status, cases, and notifications',
    icon: '👥',
  },
];

export const ACTIONS: ActionDefinition[] = [
  // ===== ORDERS =====
  {
    id: 'view_order',
    name: 'View Order',
    agent: 'Order Agent',
    category: 'orders',
    description: 'Read order details including items, status, and customer.',
    parameters: [
      {
        name: 'order_id',
        type: 'string',
        required: true,
        description: 'Order identifier',
        example: 'ORD-10550',
      },
    ],
    examples: [
      'Show me order ORD-10550',
      'View details for ORD-10482',
      'What\'s in order ORD-10501?',
    ],
    reversibility: 'FULL',
    impact: 'NONE',
    readOnly: true,
  },
  {
    id: 'cancel_order',
    name: 'Cancel Order',
    agent: 'Order Agent',
    category: 'orders',
    description: 'Cancel a pending or confirmed order. Triggers automatic refund and inventory release.',
    parameters: [
      {
        name: 'order_id',
        type: 'string',
        required: true,
        description: 'Order to cancel',
        example: 'ORD-10482',
      },
      {
        name: 'reason',
        type: 'string',
        required: false,
        description: 'Cancellation reason',
        example: 'CUSTOMER_REQUEST',
        constraints: 'Max 200 characters',
      },
    ],
    examples: [
      'Cancel order ORD-10482',
      'Cancel the VIP customer\'s order',
      'Cancel ORD-10510 due to customer request',
    ],
    restrictions: [
      'Order must be PENDING or CONFIRMED',
      'Cannot cancel SHIPPED or DELIVERED orders',
      'Cannot cancel already CANCELLED orders',
    ],
    reversibility: 'NONE',
    impact: 'HIGH',
  },
  {
    id: 'modify_order',
    name: 'Modify Order',
    agent: 'Order Agent',
    category: 'orders',
    description: 'Change line item quantities on a pending or confirmed order. Updates total amount.',
    parameters: [
      {
        name: 'order_id',
        type: 'string',
        required: true,
        description: 'Order to modify',
        example: 'ORD-10550',
      },
      {
        name: 'lines',
        type: 'array',
        required: true,
        description: 'SKU and new quantity for each line',
        example: '[{"sku": "LAP-001", "quantity": 1}]',
        constraints: '1-20 lines, quantity 1-1000',
      },
    ],
    examples: [
      'Reduce laptop quantity from 2 to 1 on ORD-10550',
      'Change watch quantity to 2 on ORD-10495',
      'Trim the order by removing one laptop',
    ],
    restrictions: [
      'Order must be PENDING or CONFIRMED',
      'Each SKU can appear only once',
      'SKU must exist in the order',
      'At least one quantity must change',
    ],
    reversibility: 'FULL',
    impact: 'MEDIUM',
  },
  {
    id: 'update_order_status',
    name: 'Update Order Status',
    agent: 'Order Agent',
    category: 'orders',
    description: 'Advance order through fulfillment lifecycle: PENDING → CONFIRMED → SHIPPED → DELIVERED.',
    parameters: [
      {
        name: 'order_id',
        type: 'string',
        required: true,
        description: 'Order to update',
        example: 'ORD-10501',
      },
      {
        name: 'status',
        type: 'string',
        required: true,
        description: 'Target status',
        example: 'SHIPPED',
        constraints: 'Must be CONFIRMED, SHIPPED, or DELIVERED',
      },
    ],
    examples: [
      'Mark ORD-10501 as SHIPPED',
      'Update order status to CONFIRMED',
      'Set ORD-10495 to DELIVERED',
    ],
    restrictions: [
      'Must follow valid progression: PENDING→CONFIRMED→SHIPPED→DELIVERED',
      'Cannot skip statuses',
      'SHIPPED status consumes reserved inventory',
    ],
    reversibility: 'PARTIAL',
    impact: 'LOW',
  },

  // ===== FINANCE =====
  {
    id: 'request_refund',
    name: 'Request Refund',
    agent: 'Customer Support Agent',
    category: 'finance',
    description: 'Ask Finance to refund a captured payment. Finance Agent will automatically process.',
    parameters: [
      {
        name: 'order_id',
        type: 'string',
        required: true,
        description: 'Order with payment to refund',
        example: 'ORD-10482',
      },
      {
        name: 'amount',
        type: 'decimal',
        required: false,
        description: 'Amount to refund (omit for full refundable amount)',
        example: '84500.00',
      },
      {
        name: 'reason',
        type: 'string',
        required: false,
        description: 'Reason for refund request',
        example: 'CUSTOMER_REQUEST',
        constraints: 'Max 200 characters',
      },
    ],
    examples: [
      'Request refund for ORD-10482',
      'Request ₹50,000 refund on the order',
      'Ask Finance to refund the customer',
    ],
    restrictions: [
      'Order must have refundable payment',
      'Amount cannot exceed refundable balance',
    ],
    reversibility: 'FULL',
    impact: 'LOW',
  },
  {
    id: 'issue_refund',
    name: 'Issue Refund',
    agent: 'Finance Agent',
    category: 'finance',
    description: 'Return money to the customer. Creates refund record and money movement.',
    parameters: [
      {
        name: 'order_id',
        type: 'string',
        required: true,
        description: 'Order with payment to refund',
        example: 'ORD-10482',
      },
      {
        name: 'amount',
        type: 'decimal',
        required: false,
        description: 'Amount to refund (omit for full refundable amount)',
        example: '84500.00',
      },
      {
        name: 'reason',
        type: 'string',
        required: false,
        description: 'Refund reason',
        example: 'ORDER_CANCELLED',
        constraints: 'Max 200 characters',
      },
    ],
    examples: [
      'Issue refund for ORD-10482',
      'Refund ₹72,000 to the customer',
      'Process full refund on the cancelled order',
    ],
    restrictions: [
      'Order must have refundable payment',
      'Amount cannot exceed refundable balance',
      'Customer Support agent lacks permission (use request_refund instead)',
    ],
    reversibility: 'NONE',
    impact: 'MEDIUM',
  },
  {
    id: 'issue_compensation',
    name: 'Issue Compensation',
    agent: 'Finance Agent',
    category: 'finance',
    description: 'Goodwill credit to customer. Order stays active. Specify amount OR percentage.',
    parameters: [
      {
        name: 'order_id',
        type: 'string',
        required: true,
        description: 'Order to compensate',
        example: 'ORD-10482',
      },
      {
        name: 'amount',
        type: 'decimal',
        required: false,
        description: 'Fixed compensation amount',
        example: '16900.00',
        constraints: 'Either amount OR percentage required',
      },
      {
        name: 'percentage',
        type: 'decimal',
        required: false,
        description: 'Percentage of order total',
        example: '20.00',
        constraints: '0.01-100.00',
      },
      {
        name: 'reason',
        type: 'string',
        required: false,
        description: 'Reason for compensation',
        example: 'DELAY_APOLOGY',
        constraints: 'Max 200 characters',
      },
    ],
    examples: [
      'Offer 20% compensation instead of cancelling',
      'Give ₹5,000 goodwill credit',
      'Compensate customer for shipping delay',
    ],
    restrictions: [
      'Order must not be CANCELLED',
      'Order must have payment',
      'Amount cannot exceed order total',
      'Must provide exactly one of amount or percentage',
    ],
    reversibility: 'NONE',
    impact: 'LOW',
  },
  {
    id: 'reverse_payment',
    name: 'Reverse Payment',
    agent: 'Finance Agent',
    category: 'finance',
    description: 'Chargeback-style full payment reversal. Returns all refundable amount.',
    parameters: [
      {
        name: 'payment_id',
        type: 'string',
        required: true,
        description: 'Payment to reverse',
        example: 'PAY-50123',
      },
      {
        name: 'reason',
        type: 'string',
        required: false,
        description: 'Reversal reason',
        example: 'FRAUD_DETECTED',
        constraints: 'Max 200 characters',
      },
    ],
    examples: [
      'Reverse payment PAY-50123',
      'Perform chargeback on the payment',
    ],
    restrictions: [
      'Payment must exist',
      'Payment must not already be REVERSED',
      'Must have refundable amount remaining',
      'Customer Support agent lacks permission',
    ],
    reversibility: 'NONE',
    impact: 'HIGH',
  },

  // ===== INVENTORY =====
  {
    id: 'reserve_inventory',
    name: 'Reserve Inventory',
    agent: 'Inventory Agent',
    category: 'inventory',
    description: 'Hold stock for an order. Reduces available inventory.',
    parameters: [
      {
        name: 'order_id',
        type: 'string',
        required: true,
        description: 'Order to reserve for',
        example: 'ORD-10495',
      },
      {
        name: 'lines',
        type: 'array',
        required: true,
        description: 'SKU and quantity to reserve',
        example: '[{"sku": "WAT-001", "quantity": 2}]',
        constraints: '1-20 lines',
      },
    ],
    examples: [
      'Reserve 2 watches for ORD-10495',
      'Hold inventory for the laptop order',
      'Reserve stock for ORD-10550',
    ],
    restrictions: [
      'SKU must be in the order',
      'Must have sufficient available stock',
      'Cannot reserve more than order line quantity',
      'Triggers restock alert if below reorder point',
    ],
    reversibility: 'FULL',
    impact: 'NONE',
  },
  {
    id: 'release_inventory',
    name: 'Release Inventory',
    agent: 'Inventory Agent',
    category: 'inventory',
    description: 'Return held stock to available pool. Omit lines to release everything.',
    parameters: [
      {
        name: 'order_id',
        type: 'string',
        required: true,
        description: 'Order holding inventory',
        example: 'ORD-10482',
      },
      {
        name: 'lines',
        type: 'array',
        required: false,
        description: 'SKU and quantity to release (omit for all)',
        example: '[{"sku": "WAT-001", "quantity": 1}]',
        constraints: '1-20 lines',
      },
    ],
    examples: [
      'Release all inventory for ORD-10482',
      'Return 1 watch to stock',
      'Free up held stock for the cancelled order',
    ],
    restrictions: [
      'SKU must be in the order',
      'Cannot release more than currently reserved',
      'Order must have reserved stock',
    ],
    reversibility: 'FULL',
    impact: 'NONE',
  },
  {
    id: 'create_restock_request',
    name: 'Create Restock Request',
    agent: 'Inventory Agent',
    category: 'inventory',
    description: 'Ask procurement to replenish a SKU.',
    parameters: [
      {
        name: 'sku',
        type: 'string',
        required: true,
        description: 'Product to restock',
        example: 'WAT-001',
      },
      {
        name: 'quantity',
        type: 'integer',
        required: true,
        description: 'Units to order',
        example: '100',
        constraints: '1-1000',
      },
    ],
    examples: [
      'Request restock of 100 watches',
      'Order more WAT-001 inventory',
      'Create restock request for low stock item',
    ],
    restrictions: [
      'SKU must exist',
    ],
    reversibility: 'PARTIAL',
    impact: 'NONE',
  },

  // ===== CRM =====
  {
    id: 'update_customer_status',
    name: 'Update Customer Status',
    agent: 'CRM Agent',
    category: 'crm',
    description: 'Change customer lifecycle status: ACTIVE, AT_RISK, or SUSPENDED.',
    parameters: [
      {
        name: 'customer_id',
        type: 'string',
        required: true,
        description: 'Customer to update',
        example: 'CUST-1001',
      },
      {
        name: 'status',
        type: 'string',
        required: true,
        description: 'New status',
        example: 'AT_RISK',
        constraints: 'Must be ACTIVE, AT_RISK, or SUSPENDED',
      },
      {
        name: 'reason',
        type: 'string',
        required: false,
        description: 'Reason for status change',
        example: 'VIP_ORDER_CANCELLED',
        constraints: 'Max 200 characters',
      },
    ],
    examples: [
      'Mark customer as AT_RISK',
      'Update CUST-1001 status to SUSPENDED',
      'Change customer status to ACTIVE',
    ],
    restrictions: [
      'Customer must exist',
      'New status must differ from current',
    ],
    reversibility: 'FULL',
    impact: 'LOW',
  },
  {
    id: 'create_customer_case',
    name: 'Create Customer Case',
    agent: 'CRM Agent',
    category: 'crm',
    description: 'Open a CRM case for customer follow-up or investigation.',
    parameters: [
      {
        name: 'customer_id',
        type: 'string',
        required: true,
        description: 'Customer for the case',
        example: 'CUST-1001',
      },
      {
        name: 'order_id',
        type: 'string',
        required: false,
        description: 'Related order (optional)',
        example: 'ORD-10482',
      },
      {
        name: 'reason',
        type: 'string',
        required: true,
        description: 'Case reason',
        example: 'HIGH_VALUE_REFUND',
        constraints: '1-200 characters',
      },
    ],
    examples: [
      'Open case for high-value refund review',
      'Create customer case for complaint',
      'Start investigation case for CUST-1001',
    ],
    restrictions: [
      'Customer must exist',
      'Order must exist if provided',
      'Reason required',
    ],
    reversibility: 'PARTIAL',
    impact: 'LOW',
  },
  {
    id: 'send_customer_notification',
    name: 'Send Customer Notification',
    agent: 'CRM Agent',
    category: 'crm',
    description: 'Send EMAIL or SMS notification to customer using template.',
    parameters: [
      {
        name: 'customer_id',
        type: 'string',
        required: true,
        description: 'Customer to notify',
        example: 'CUST-1005',
      },
      {
        name: 'order_id',
        type: 'string',
        required: false,
        description: 'Related order (optional)',
        example: 'ORD-10501',
      },
      {
        name: 'template',
        type: 'string',
        required: true,
        description: 'Notification template',
        example: 'ORDER_SHIPPED',
        constraints: 'REFUND_ISSUED, ORDER_UPDATED, ORDER_CANCELLED, COMPENSATION_ISSUED, ORDER_STATUS_UPDATED, ORDER_SHIPPED',
      },
      {
        name: 'channel',
        type: 'string',
        required: true,
        description: 'Communication channel',
        example: 'SMS',
        constraints: 'EMAIL or SMS',
      },
    ],
    examples: [
      'Send SMS about order shipment to CUST-1005',
      'Email customer about their refund',
      'Notify via SMS that order ORD-10501 shipped',
    ],
    restrictions: [
      'Customer must exist',
      'Order must exist if provided',
      'Template must be valid',
      'Uses customer contact PII',
    ],
    reversibility: 'NONE',
    impact: 'LOW',
  },
];

export function getActionsByCategory(categoryId: string): ActionDefinition[] {
  return ACTIONS.filter((action) => action.category === categoryId);
}

export function searchActions(query: string): ActionDefinition[] {
  const lower = query.toLowerCase();
  return ACTIONS.filter(
    (action) =>
      action.name.toLowerCase().includes(lower) ||
      action.description.toLowerCase().includes(lower) ||
      action.examples.some((ex) => ex.toLowerCase().includes(lower)) ||
      action.agent.toLowerCase().includes(lower)
  );
}

export function getActionById(id: string): ActionDefinition | undefined {
  return ACTIONS.find((action) => action.id === id);
}
