/** Input shape accepted by {@link AuthMethodRepository.create} when inserting a new row into `auth.auth_methods`. */
export interface AuthMethodCreateData {
  user_id: number;
  method_type: string;
  provider?: string;
  provider_user_id?: string;
  encrypted_secret?: string;
  is_primary?: boolean;
  created_by_user_id?: number;
}
