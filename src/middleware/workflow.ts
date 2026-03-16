// Workflow state machine validation

import { BookingStatus, JobStatus, BookingType, JMLSubType } from '../types';

/**
 * Booking status transitions (matching frontend logic)
 * Includes ITAD and JML workflows
 */
export const bookingTransitions: Record<BookingStatus, BookingStatus[]> = {
  pending: ['created', 'cancelled', 'device_allocated'], // JML can go to device_allocated
  created: ['scheduled', 'cancelled'],
  scheduled: ['collected', 'cancelled', 'courier_booked'], // JML can go to courier_booked
  collected: ['sanitised', 'warehouse', 'in_transit'], // ITAD: sanitised, Leaver: warehouse, New-starter/Mover: in_transit
  warehouse: ['sanitised'], // ITAD and Leaver: warehouse → sanitised
  sanitised: ['graded'],
  graded: ['completed', 'delivery_scheduled', 'inventory'], // ITAD: completed, Leaver: inventory, Breakfix: delivery_scheduled (re-delivery)
  inventory: ['completed'], // Added to inventory (handles both reuse and disposal)
  completed: [],
  cancelled: [],
  // JML-specific statuses
  device_allocated: ['courier_booked', 'cancelled'],
  courier_booked: ['in_transit', 'delivered', 'cancelled'],
  in_transit: ['delivered', 'cancelled'],
  delivered: ['completed'], // JML new starter/mover/breakfix outbound - ticket closed
  collection_scheduled: ['collected', 'cancelled'], // JML leaver - collection scheduled
  // Breakfix re-delivery statuses
  delivery_scheduled: ['in_transit', 'cancelled'], // Breakfix: delivery_scheduled → in_transit
};

/**
 * Job status transitions (matching frontend logic)
 */
export const jobTransitions: Record<JobStatus, JobStatus[]> = {
  booked: ['routed', 'en_route'],
  routed: ['en_route'],
  en_route: ['arrived'],
  arrived: ['collected', 'completed'], // Can complete directly if no collection needed
  collected: ['warehouse', 'completed', 'in_transit'], // ITAD/Leaver: warehouse, Direct completion, New-starter/Mover: in_transit (with assets)
  in_transit: ['arrived'], // Vehicle with assets arriving at delivery location
  warehouse: ['sanitised'],
  sanitised: ['graded'],
  graded: ['completed', 'delivery_routed', 'inventory'], // ITAD: completed, Leaver: inventory, Breakfix: delivery_routed (re-delivery)
  inventory: ['completed'], // Added to inventory (handles both reuse and disposal)
  completed: [],
  cancelled: [],
  // Breakfix re-delivery statuses
  delivery_routed: ['delivery_en_route'], // Breakfix: delivery_routed → delivery_en_route
  delivery_en_route: ['delivery_arrived'], // Breakfix: delivery_en_route → delivery_arrived
  delivery_arrived: ['completed'], // Breakfix: delivery_arrived → completed
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
      in_transit: [],
      delivered: [],
      collection_scheduled: [],
      inventory: [],
    },
  },
  jml: {
    new_starter: {
      pending: ['created', 'cancelled', 'device_allocated'],
      created: ['scheduled', 'cancelled'],
      scheduled: ['collected', 'cancelled', 'courier_booked'],
      collected: ['in_transit'], // New-starter: collected → in_transit
      warehouse: [],
      sanitised: [],
      graded: [],
      completed: [],
      cancelled: [],
      device_allocated: ['courier_booked', 'cancelled'],
      courier_booked: ['in_transit', 'delivered', 'cancelled'],
      in_transit: ['delivered', 'cancelled'],
      delivered: ['completed'],
      collection_scheduled: [],
      inventory: [],
      delivery_scheduled: [],
    },
    leaver: {
      pending: ['created', 'cancelled'],
      created: ['scheduled', 'cancelled'],
      scheduled: ['collected', 'cancelled', 'collection_scheduled'],
      collected: ['warehouse'], // Leaver: collected → warehouse
      warehouse: ['sanitised'],
      sanitised: ['graded'],
      graded: ['inventory'], // Leaver: graded → inventory (handles both reuse and disposal)
      inventory: ['completed'], // Added to inventory
      completed: [],
      cancelled: [],
      device_allocated: [],
      courier_booked: [],
      in_transit: [],
      delivered: [],
      collection_scheduled: ['collected', 'cancelled'],
      delivery_scheduled: [],
    },
    mover: {
      // Mover: Leaver first (collect old device), then New Starter (deliver new device)
      pending: ['created', 'cancelled'],
      created: ['scheduled', 'cancelled'],
      scheduled: ['collected', 'cancelled'], // Collect old device first
      collected: ['warehouse'], // Mover: collected old device → warehouse
      warehouse: ['sanitised'],
      sanitised: ['graded'],
      graded: ['inventory'], // Old device: graded → inventory
      inventory: ['device_allocated'], // After old device processed, allocate new device
      device_allocated: ['courier_booked', 'cancelled'], // New device allocated
      courier_booked: ['in_transit', 'delivered', 'cancelled'], // New device in transit
      in_transit: ['delivered', 'cancelled'], // New device delivered
      delivered: ['completed'], // New device delivered, job complete
      completed: [],
      cancelled: [],
      collection_scheduled: [],
      delivery_scheduled: [],
    },
    breakfix: {
      // Breakfix: New Starter first (deliver replacement), then Leaver (collect broken device)
      pending: ['created', 'cancelled', 'device_allocated'], // Can allocate replacement device first
      created: ['scheduled', 'cancelled'],
      scheduled: ['courier_booked', 'cancelled'], // Schedule delivery of replacement device
      device_allocated: ['courier_booked', 'cancelled'], // Replacement device allocated
      courier_booked: ['in_transit', 'delivered', 'cancelled'], // Replacement device in transit
      in_transit: ['delivered', 'cancelled'], // Replacement device delivered
      delivered: ['collected'], // After replacement delivered, collect broken device
      collected: ['warehouse'], // Breakfix: collected broken device → warehouse
      warehouse: ['sanitised'], // Breakfix: warehouse → sanitised
      sanitised: ['graded'],
      graded: ['inventory'], // Broken device: graded → inventory
      inventory: ['completed'], // Broken device added to inventory
      completed: [],
      cancelled: [],
      collection_scheduled: [],
      delivery_scheduled: [], // Not used in breakfix workflow
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
      in_transit: [],
      warehouse: ['sanitised'],
      sanitised: ['graded'],
      graded: ['completed'],
      completed: [],
      cancelled: [],
      inventory: [],
      delivery_routed: [],
      delivery_en_route: [],
      delivery_arrived: [],
    },
  },
  jml: {
    new_starter: {
      booked: ['routed'],
      routed: ['collected'], // Driver is at warehouse, can collect directly
      collected: ['in_transit'], // New-starter: collected → in_transit
      in_transit: ['arrived'], // Arriving at client
      arrived: ['completed'], // At client: completed
      warehouse: [],
      sanitised: [],
      graded: [],
      completed: [],
      cancelled: [],
      en_route: [], // Not used in new_starter workflow
      inventory: [],
      delivery_routed: [],
      delivery_en_route: [],
      delivery_arrived: [],
    },
    leaver: {
      booked: ['routed', 'en_route'],
      routed: ['en_route'],
      en_route: ['arrived'],
      arrived: ['collected'],
      collected: ['warehouse'], // Leaver: collected → warehouse
      in_transit: [],
      warehouse: ['sanitised'],
      sanitised: ['graded'],
      graded: ['inventory'], // Leaver: graded → inventory (handles both reuse and disposal)
      inventory: ['completed'], // Added to inventory
      completed: [],
      cancelled: [],
      delivery_routed: [],
      delivery_en_route: [],
      delivery_arrived: [],
    },
    mover: {
      // Mover: Leaver first (collect old device), then New Starter (deliver new device)
      booked: ['routed', 'en_route'],
      routed: ['en_route'],
      en_route: ['arrived'], // At old office
      arrived: ['collected'], // At old office: collected old device
      collected: ['warehouse'], // Mover: collected old device → warehouse
      warehouse: ['sanitised'],
      sanitised: ['graded'],
      graded: ['inventory'], // Old device: graded → inventory
      inventory: ['routed'], // After old device processed, route new device delivery
      // Note: For new device delivery, we reuse the same job but transition through delivery states
      // After inventory, admin routes new device delivery
      in_transit: ['delivery_arrived'], // New device in transit to new office
      delivery_arrived: ['completed'], // New device delivered, job complete
      completed: [],
      cancelled: [],
      delivery_routed: ['delivery_en_route'], // New device delivery routed
      delivery_en_route: ['delivery_arrived'], // New device delivery en route
    },
    breakfix: {
      // Breakfix: New Starter first (deliver replacement), then Leaver (collect broken device)
      booked: ['routed'], // Route replacement device delivery first
      routed: ['collected'], // Driver collects replacement device from warehouse
      collected: ['in_transit'], // Replacement device in transit
      in_transit: ['arrived'], // Arriving at client with replacement
      arrived: ['completed'], // Replacement delivered (first phase complete)
      // After replacement delivered, collect broken device
      // Note: Job transitions back to collection phase
      warehouse: ['sanitised'], // Broken device at warehouse
      sanitised: ['graded'],
      graded: ['inventory'], // Broken device: graded → inventory
      inventory: ['completed'], // Broken device added to inventory
      completed: [],
      cancelled: [],
      en_route: [], // Not used in breakfix workflow
      delivery_routed: [], // Not used in breakfix workflow
      delivery_en_route: [], // Not used in breakfix workflow
      delivery_arrived: [], // Not used in breakfix workflow
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
    },
    jml: {
      new_starter: ['pending', 'created', 'scheduled', 'collected', 'in_transit', 'delivered', 'completed'],
      leaver: ['pending', 'created', 'scheduled', 'collected', 'warehouse', 'sanitised', 'graded', 'inventory', 'completed'],
      mover: ['pending', 'created', 'scheduled', 'collected', 'warehouse', 'sanitised', 'graded', 'inventory', 'device_allocated', 'courier_booked', 'in_transit', 'delivered', 'completed'],
      breakfix: ['pending', 'created', 'scheduled', 'device_allocated', 'courier_booked', 'in_transit', 'delivered', 'collected', 'warehouse', 'sanitised', 'graded', 'inventory', 'completed'],
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
    },
    jml: {
      new_starter: ['booked', 'routed', 'collected', 'in_transit', 'arrived', 'completed'],
      leaver: ['booked', 'routed', 'en_route', 'arrived', 'collected', 'warehouse', 'sanitised', 'graded', 'inventory', 'completed'],
      mover: ['booked', 'routed', 'en_route', 'arrived', 'collected', 'warehouse', 'sanitised', 'graded', 'inventory', 'delivery_routed', 'delivery_en_route', 'delivery_arrived', 'completed'],
      breakfix: ['booked', 'routed', 'collected', 'in_transit', 'arrived', 'warehouse', 'sanitised', 'graded', 'inventory', 'completed'],
    },
  };

  const typeSequences = sequences[bookingType];
  if (!typeSequences) return [];

  const subTypeSequence = jmlSubType && bookingType === 'jml' 
    ? typeSequences[jmlSubType] 
    : typeSequences.default;
  
  return subTypeSequence || [];
}
