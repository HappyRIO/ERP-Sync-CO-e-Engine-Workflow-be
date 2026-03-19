// Workflow state machine validation

import { BookingStatus, JobStatus, BookingType, JMLSubType } from '../types';

/**
 * Booking status transitions (matching frontend logic)
 * Includes ITAD and JML workflows
 */
export const bookingTransitions: Record<BookingStatus, BookingStatus[]> = {
  pending: ['created', 'cancelled', 'device_allocated'], // JML can go to device_allocated
  created: ['scheduled', 'cancelled', 'device_allocated', 'collection_scheduled'], // JML can go directly to device_allocated or collection_scheduled
  scheduled: ['collected', 'cancelled', 'courier_booked'], // ITAD: collected, JML can go to courier_booked
  collected: ['sanitised', 'warehouse', 'dispatched'], // ITAD: sanitised, Leaver: warehouse, New-starter/Mover: dispatched
  warehouse: ['sanitised', 'inventory'], // ITAD: sanitised, Mover: inventory
  sanitised: ['graded'],
  graded: ['completed', 'inventory'], // ITAD: completed, Leaver: inventory
  inventory: ['completed', 'device_allocated'], // Added to inventory (handles both reuse and disposal), Mover: device_allocated
  completed: [],
  cancelled: [],
  // JML-specific statuses
  device_allocated: ['courier_booked', 'cancelled'],
  courier_booked: ['dispatched', 'cancelled'],
  dispatched: ['delivered', 'collected', 'cancelled'], // JML: delivered (for deliveries), collected (for collections)
  delivered: ['completed', 'collected'], // JML new starter/mover/breakfix outbound - ticket closed, Breakfix: collected
  collection_scheduled: ['collected', 'cancelled'], // JML leaver/mover - collection scheduled
};

/**
 * Job status transitions (matching frontend logic)
 */
export const jobTransitions: Record<JobStatus, JobStatus[]> = {
  booked: ['routed', 'en_route', 'device_allocated', 'courier_booked'], // ITAD: routed/en_route, JML: device_allocated/courier_booked
  routed: ['en_route'],
  en_route: ['arrived'],
  arrived: ['collected', 'completed'], // Can complete directly if no collection needed
  collected: ['warehouse', 'completed', 'dispatched'], // ITAD/Leaver: warehouse, Direct completion, JML: dispatched
  warehouse: ['sanitised', 'inventory'], // ITAD: sanitised, Mover: inventory
  sanitised: ['graded'],
  graded: ['completed', 'inventory'], // ITAD: completed, Leaver: inventory
  inventory: ['completed', 'device_allocated'], // Added to inventory (handles both reuse and disposal), Mover: device_allocated
  completed: [],
  cancelled: [],
  // JML-specific statuses
  device_allocated: ['courier_booked', 'cancelled'],
  courier_booked: ['dispatched', 'cancelled'],
  dispatched: ['delivered', 'collected', 'cancelled'], // JML: delivered (for deliveries), collected (for collections)
  delivered: ['completed', 'collected'], // JML new starter/mover/breakfix outbound - ticket closed, Breakfix: collected
  // Mover delivery statuses
  delivery_courier_booked: ['delivery_dispatched', 'cancelled'], // Mover: delivery_courier_booked → delivery_dispatched
  delivery_dispatched: ['delivered', 'cancelled'], // Mover: delivery_dispatched → delivered
};

/**
 * Check if booking status transition is valid
 */
export function isValidBookingTransition(
  from: BookingStatus,
  to: BookingStatus
): boolean {
  if (from === to) return true; // No-op transition
  const allowed = bookingTransitions[from] || [];
  return allowed.includes(to);
}

/**
 * Check if job status transition is valid
 */
export function isValidJobTransition(
  from: JobStatus,
  to: JobStatus
): boolean {
  if (from === to) return true; // No-op transition
  const allowed = jobTransitions[from] || [];
  return allowed.includes(to);
}

/**
 * Get next valid statuses for booking
 */
export function getNextValidBookingStatuses(
  current: BookingStatus
): BookingStatus[] {
  return bookingTransitions[current] || [];
}

/**
 * Get next valid statuses for job
 */
export function getNextValidJobStatuses(
  current: JobStatus
): JobStatus[] {
  return jobTransitions[current] || [];
}

/**
 * Type-specific booking workflow definitions
 */
const bookingWorkflows: Record<BookingType, Record<JMLSubType | 'default', Record<BookingStatus, BookingStatus[]>>> = {
  itad_collection: {
    default: {
      pending: ['created', 'cancelled'],
      created: ['scheduled', 'cancelled'],
      scheduled: ['collected', 'cancelled'],
      collected: ['warehouse'], // ITAD: collected → warehouse
      warehouse: ['sanitised'],
      sanitised: ['graded'],
      graded: ['completed'],
      completed: [],
      cancelled: [],
      device_allocated: [],
      courier_booked: [],
      dispatched: [],
      delivered: [],
      collection_scheduled: [],
      inventory: [],
    },
    // ITAD doesn't use JML subtypes, but TypeScript requires them
    new_starter: {
      pending: [],
      created: [],
      scheduled: [],
      collected: [],
      warehouse: [],
      sanitised: [],
      graded: [],
      completed: [],
      cancelled: [],
      device_allocated: [],
      courier_booked: [],
      dispatched: [],
      delivered: [],
      collection_scheduled: [],
      inventory: [],
    },
    leaver: {
      pending: [],
      created: [],
      scheduled: [],
      collected: [],
      warehouse: [],
      sanitised: [],
      graded: [],
      completed: [],
      cancelled: [],
      device_allocated: [],
      courier_booked: [],
      dispatched: [],
      delivered: [],
      collection_scheduled: [],
      inventory: [],
    },
    mover: {
      pending: [],
      created: [],
      scheduled: [],
      collected: [],
      warehouse: [],
      sanitised: [],
      graded: [],
      completed: [],
      cancelled: [],
      device_allocated: [],
      courier_booked: [],
      dispatched: [],
      delivered: [],
      collection_scheduled: [],
      inventory: [],
    },
    breakfix: {
      pending: [],
      created: [],
      scheduled: [],
      collected: [],
      warehouse: [],
      sanitised: [],
      graded: [],
      completed: [],
      cancelled: [],
      device_allocated: [],
      courier_booked: [],
      dispatched: [],
      delivered: [],
      collection_scheduled: [],
      inventory: [],
    },
  },
  jml: {
    default: {
      // JML default workflow (not used, but required by type)
      pending: [],
      created: [],
      scheduled: [],
      collected: [],
      warehouse: [],
      sanitised: [],
      graded: [],
      completed: [],
      cancelled: [],
      device_allocated: [],
      courier_booked: [],
      dispatched: [],
      delivered: [],
      collection_scheduled: [],
      inventory: [],
    },
    new_starter: {
      pending: ['created', 'cancelled', 'device_allocated'],
      created: ['device_allocated', 'cancelled'], // Skip scheduled, go directly to device_allocated
      scheduled: [],
      collected: [],
      warehouse: [],
      sanitised: [],
      graded: [],
      completed: [],
      cancelled: [],
      device_allocated: ['courier_booked', 'cancelled'],
      courier_booked: ['dispatched', 'cancelled'],
      dispatched: ['delivered', 'cancelled'],
      delivered: ['completed'],
      collection_scheduled: [],
      inventory: [],
    },
    leaver: {
      pending: ['created', 'cancelled'],
      created: ['collection_scheduled', 'cancelled'], // Skip scheduled, go directly to collection_scheduled
      scheduled: [],
      collected: ['warehouse'], // Leaver: collected → warehouse
      warehouse: ['sanitised'],
      sanitised: ['graded'],
      graded: ['inventory'], // Leaver: graded → inventory (handles both reuse and disposal)
      inventory: ['completed'], // Added to inventory
      completed: [],
      cancelled: [],
      device_allocated: [],
      courier_booked: [],
      dispatched: [],
      delivered: [],
      collection_scheduled: ['collected', 'cancelled'],
    },
    mover: {
      // Mover: Leaver first (collect old device), then New Starter (deliver new device)
      pending: ['created', 'cancelled'],
      created: ['collection_scheduled', 'cancelled'], // Skip scheduled, go directly to collection_scheduled
      scheduled: [],
      collected: ['warehouse'], // Mover: collected old device → warehouse
      warehouse: ['graded'], // Mover: grade at warehouse (no sanitised booking status)
      sanitised: [],
      graded: ['inventory'],
      inventory: ['device_allocated'], // After old device processed, allocate new device
      device_allocated: ['courier_booked', 'cancelled'], // New device allocated
      courier_booked: ['dispatched', 'cancelled'], // New device courier booked
      dispatched: ['delivered', 'cancelled'], // New device dispatched
      delivered: ['completed'], // New device delivered, job complete
      completed: [],
      cancelled: [],
      collection_scheduled: ['collected', 'cancelled'],
    },
    breakfix: {
      // Breakfix: New Starter first (deliver replacement), then Leaver (collect broken device)
      pending: ['created', 'cancelled', 'device_allocated'], // Can allocate replacement device first
      created: ['device_allocated', 'cancelled'], // Skip scheduled, go directly to device_allocated
      scheduled: [],
      collected: ['warehouse'], // Breakfix: collected broken device → warehouse
      warehouse: ['sanitised'], // Breakfix: warehouse → sanitised
      sanitised: ['graded'],
      graded: ['inventory'], // Broken device: graded → inventory
      inventory: ['completed'], // Broken device added to inventory
      completed: [],
      cancelled: [],
      device_allocated: ['courier_booked', 'cancelled'], // Replacement device allocated
      courier_booked: ['dispatched', 'cancelled'], // Replacement device courier booked
      dispatched: ['delivered', 'cancelled'], // Replacement device dispatched
      delivered: ['collected'], // After replacement delivered, collect broken device
      collection_scheduled: [],
    },
  },
};

/**
 * Type-specific job workflow definitions
 */
const jobWorkflows: Record<BookingType, Record<JMLSubType | 'default', Record<JobStatus, JobStatus[]>>> = {
  itad_collection: {
    default: {
      booked: ['routed', 'en_route'],
      routed: ['en_route'],
      en_route: ['arrived'],
      arrived: ['collected'],
      collected: ['warehouse'], // ITAD: collected → warehouse
      warehouse: ['sanitised'],
      sanitised: ['graded'],
      graded: ['completed'],
      completed: [],
      cancelled: [],
      inventory: [],
      device_allocated: [],
      courier_booked: [],
      dispatched: [],
      delivered: [],
      delivery_courier_booked: [],
      delivery_dispatched: [],
    },
    // ITAD doesn't use JML subtypes, but TypeScript requires them
    new_starter: {
      booked: [],
      routed: [],
      en_route: [],
      arrived: [],
      collected: [],
      warehouse: [],
      sanitised: [],
      graded: [],
      completed: [],
      cancelled: [],
      inventory: [],
      device_allocated: [],
      courier_booked: [],
      dispatched: [],
      delivered: [],
      delivery_courier_booked: [],
      delivery_dispatched: [],
    },
    leaver: {
      booked: [],
      routed: [],
      en_route: [],
      arrived: [],
      collected: [],
      warehouse: [],
      sanitised: [],
      graded: [],
      completed: [],
      cancelled: [],
      inventory: [],
      device_allocated: [],
      courier_booked: [],
      dispatched: [],
      delivered: [],
      delivery_courier_booked: [],
      delivery_dispatched: [],
    },
    mover: {
      booked: [],
      routed: [],
      en_route: [],
      arrived: [],
      collected: [],
      warehouse: [],
      sanitised: [],
      graded: [],
      completed: [],
      cancelled: [],
      inventory: [],
      device_allocated: [],
      courier_booked: [],
      dispatched: [],
      delivered: [],
      delivery_courier_booked: [],
      delivery_dispatched: [],
    },
    breakfix: {
      booked: [],
      routed: [],
      en_route: [],
      arrived: [],
      collected: [],
      warehouse: [],
      sanitised: [],
      graded: [],
      completed: [],
      cancelled: [],
      inventory: [],
      device_allocated: [],
      courier_booked: [],
      dispatched: [],
      delivered: [],
      delivery_courier_booked: [],
      delivery_dispatched: [],
    },
  },
  jml: {
    default: {
      // JML default workflow (not used, but required by type)
      booked: [],
      routed: [],
      en_route: [],
      arrived: [],
      collected: [],
      warehouse: [],
      sanitised: [],
      graded: [],
      completed: [],
      cancelled: [],
      inventory: [],
      device_allocated: [],
      courier_booked: [],
      dispatched: [],
      delivered: [],
      delivery_courier_booked: [],
      delivery_dispatched: [],
    },
    new_starter: {
      booked: ['device_allocated'],
      device_allocated: ['courier_booked', 'cancelled'],
      courier_booked: ['dispatched', 'cancelled'],
      dispatched: ['delivered', 'cancelled'],
      delivered: ['completed'],
      completed: [],
      cancelled: [],
      routed: [],
      en_route: [],
      arrived: [],
      collected: [],
      warehouse: [],
      sanitised: [],
      graded: [],
      inventory: [],
      delivery_courier_booked: [],
      delivery_dispatched: [],
    },
    leaver: {
      booked: ['courier_booked'],
      courier_booked: ['dispatched', 'cancelled'],
      dispatched: ['collected', 'cancelled'],
      collected: ['warehouse'], // Leaver: collected → warehouse
      warehouse: ['sanitised'],
      sanitised: ['graded'],
      graded: ['inventory'], // Leaver: graded → inventory (handles both reuse and disposal)
      inventory: ['completed'], // Added to inventory
      completed: [],
      cancelled: [],
      routed: [],
      en_route: [],
      arrived: [],
      device_allocated: [],
      delivered: [],
      delivery_courier_booked: [],
      delivery_dispatched: [],
    },
    mover: {
      // Mover: Leaver first (collect old device), then New Starter (deliver new device)
      booked: ['courier_booked'],
      courier_booked: ['dispatched', 'cancelled'],
      dispatched: ['collected', 'cancelled'], // Courier picks up old device
      collected: ['warehouse'], // Mover: collected old device → warehouse
      warehouse: ['graded'],
      sanitised: [],
      graded: ['inventory'],
      inventory: ['device_allocated'], // After old device processed, allocate new device
      device_allocated: ['delivery_courier_booked', 'cancelled'], // New device allocated, book courier for delivery
      delivery_courier_booked: ['delivery_dispatched', 'cancelled'], // Delivery courier booked
      delivery_dispatched: ['delivered', 'cancelled'], // Delivery courier picked up new device
      delivered: ['completed'], // New device delivered, job complete
      completed: [],
      cancelled: [],
      routed: [],
      en_route: [],
      arrived: [],
    },
    breakfix: {
      // Breakfix: New Starter first (deliver replacement), then Leaver (collect broken device)
      booked: ['device_allocated'],
      device_allocated: ['courier_booked', 'cancelled'], // Replacement device allocated
      courier_booked: ['dispatched', 'cancelled'], // Replacement device courier booked
      dispatched: ['delivered', 'cancelled'], // Replacement device dispatched
      delivered: ['collected'], // After replacement delivered, collect broken device
      collected: ['warehouse'], // Breakfix: collected broken device → warehouse
      warehouse: ['sanitised'], // Broken device at warehouse
      sanitised: ['graded'],
      graded: ['inventory'], // Broken device: graded → inventory
      inventory: ['completed'], // Broken device added to inventory
      completed: [],
      cancelled: [],
      routed: [],
      en_route: [],
      arrived: [],
      delivery_courier_booked: [],
      delivery_dispatched: [],
    },
  },
};

/**
 * Check if booking status transition is valid for a specific booking type
 */
export function isValidBookingTransitionForType(
  from: BookingStatus,
  to: BookingStatus,
  bookingType: BookingType,
  jmlSubType?: JMLSubType | null
): boolean {
  if (from === to) return true; // No-op transition
  
  const workflow = bookingWorkflows[bookingType];
  if (!workflow) return false;
  
  const subTypeWorkflow = jmlSubType && bookingType === 'jml' 
    ? workflow[jmlSubType] 
    : workflow.default;
  
  if (!subTypeWorkflow) return false;
  
  const allowed = subTypeWorkflow[from] || [];
  return allowed.includes(to);
}

/**
 * Check if job status transition is valid for a specific booking type
 */
export function isValidJobTransitionForType(
  from: JobStatus,
  to: JobStatus,
  bookingType: BookingType,
  jmlSubType?: JMLSubType | null
): boolean {
  if (from === to) return true; // No-op transition
  
  const workflow = jobWorkflows[bookingType];
  if (!workflow) return false;
  
  const subTypeWorkflow = jmlSubType && bookingType === 'jml' 
    ? workflow[jmlSubType] 
    : workflow.default;
  
  if (!subTypeWorkflow) return false;
  
  const allowed = subTypeWorkflow[from] || [];
  return allowed.includes(to);
}

/**
 * Get next valid booking statuses for a specific booking type
 */
export function getNextValidBookingStatusesForType(
  current: BookingStatus,
  bookingType: BookingType,
  jmlSubType?: JMLSubType | null
): BookingStatus[] {
  const workflow = bookingWorkflows[bookingType];
  if (!workflow) return [];
  
  const subTypeWorkflow = jmlSubType && bookingType === 'jml' 
    ? workflow[jmlSubType] 
    : workflow.default;
  
  if (!subTypeWorkflow) return [];
  
  return subTypeWorkflow[current] || [];
}

/**
 * Get next valid job statuses for a specific booking type
 */
export function getNextValidJobStatusesForType(
  current: JobStatus,
  bookingType: BookingType,
  jmlSubType?: JMLSubType | null
): JobStatus[] {
  const workflow = jobWorkflows[bookingType];
  if (!workflow) return [];
  
  const subTypeWorkflow = jmlSubType && bookingType === 'jml' 
    ? workflow[jmlSubType] 
    : workflow.default;
  
  if (!subTypeWorkflow) return [];
  
  return subTypeWorkflow[current] || [];
}

/**
 * Get expected booking status sequence for a booking type
 * Used for validation and UI display
 */
export function getBookingStatusSequence(
  bookingType: BookingType,
  jmlSubType?: JMLSubType | null
): BookingStatus[] {
  const sequences: Record<BookingType, Record<JMLSubType | 'default', BookingStatus[]>> = {
    itad_collection: {
      default: ['pending', 'created', 'scheduled', 'collected', 'warehouse', 'sanitised', 'graded', 'completed'],
      new_starter: [],
      leaver: [],
      mover: [],
      breakfix: [],
    },
    jml: {
      default: [], // JML default (not used)
      new_starter: ['pending', 'created', 'device_allocated', 'courier_booked', 'dispatched', 'delivered', 'completed'],
      leaver: ['pending', 'created', 'collection_scheduled', 'collected', 'warehouse', 'sanitised', 'graded', 'inventory', 'completed'],
      mover: ['pending', 'created', 'collection_scheduled', 'collected', 'warehouse', 'graded', 'inventory', 'device_allocated', 'courier_booked', 'dispatched', 'delivered', 'completed'],
      breakfix: ['pending', 'created', 'device_allocated', 'courier_booked', 'dispatched', 'delivered', 'collected', 'warehouse', 'sanitised', 'graded', 'inventory', 'completed'],
    },
  };

  const typeSequences = sequences[bookingType];
  if (!typeSequences) return [];

  const subTypeSequence = jmlSubType && bookingType === 'jml' 
    ? typeSequences[jmlSubType] 
    : typeSequences.default;
  
  return subTypeSequence || [];
}

/**
 * Get expected job status sequence for a booking type
 * Used for validation and UI display
 */
export function getJobStatusSequence(
  bookingType: BookingType,
  jmlSubType?: JMLSubType | null
): JobStatus[] {
  const sequences: Record<BookingType, Record<JMLSubType | 'default', JobStatus[]>> = {
    itad_collection: {
      default: ['booked', 'routed', 'en_route', 'arrived', 'collected', 'warehouse', 'sanitised', 'graded', 'completed'],
      new_starter: [],
      leaver: [],
      mover: [],
      breakfix: [],
    },
    jml: {
      default: [], // JML default (not used)
      new_starter: ['booked', 'device_allocated', 'courier_booked', 'dispatched', 'delivered', 'completed'],
      leaver: ['booked', 'courier_booked', 'dispatched', 'collected', 'warehouse', 'sanitised', 'graded', 'inventory', 'completed'],
      mover: ['booked', 'courier_booked', 'dispatched', 'collected', 'warehouse', 'graded', 'inventory', 'device_allocated', 'delivery_courier_booked', 'delivery_dispatched', 'delivered', 'completed'],
      breakfix: ['booked', 'device_allocated', 'courier_booked', 'dispatched', 'delivered', 'collected', 'warehouse', 'sanitised', 'graded', 'inventory', 'completed'],
    },
  };

  const typeSequences = sequences[bookingType];
  if (!typeSequences) return [];

  const subTypeSequence = jmlSubType && bookingType === 'jml' 
    ? typeSequences[jmlSubType] 
    : typeSequences.default;
  
  return subTypeSequence || [];
}
