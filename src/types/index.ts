// Type definitions matching frontend types
import { Request } from 'express';

export type UserRole = 'admin' | 'client' | 'reseller' | 'driver';
export type UserStatus = 'pending' | 'active' | 'inactive' | 'declined';

export type BookingStatus = 
  | 'pending'
  | 'created' 
  | 'scheduled' 
  | 'collected' 
  | 'warehouse'
  | 'sanitised' 
  | 'graded' 
  | 'completed' 
  | 'cancelled'
  | 'device_allocated'
  | 'courier_booked'
  | 'dispatched'
  | 'delivered'
  | 'collection_scheduled'
  | 'inventory'; // Leaver: added to inventory (handles both reuse and disposal)

export type BookingType = 'itad_collection' | 'jml';

export type JMLSubType = 'new_starter' | 'leaver' | 'breakfix' | 'mover';

export type JobStatus = 
  | 'booked' 
  | 'routed' 
  | 'en_route' 
  | 'arrived' 
  | 'collected' 
  | 'warehouse' 
  | 'sanitised' 
  | 'graded' 
  | 'completed' 
  | 'cancelled'
  | 'device_allocated'      // JML: Device allocated from inventory
  | 'courier_booked'        // JML: Courier assigned/booked
  | 'dispatched'            // JML: Courier picked up package
  | 'delivered'             // JML: Package delivered to destination
  | 'delivery_courier_booked' // Mover: Delivery phase courier booked
  | 'delivery_dispatched'   // Mover: Delivery phase dispatched
  | 'inventory';            // Leaver: added to inventory (handles both reuse and disposal)

export type CertificateType = 
  | 'chain_of_custody' 
  | 'data_wipe' 
  | 'destruction' 
  | 'recycling' 
  | 'esg_report';

// JWT Payload
export interface JWTPayload {
  userId: string;
  email: string;
  role: UserRole;
  tenantId: string;
}

// Request with authenticated user
export interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
}

// API Response wrapper
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  fields?: Record<string, string>; // Field-specific validation errors
}
