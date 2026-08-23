/**
 * Hono RPC 编译期契约测试。
 *
 * 本文件由根级 `pnpm typecheck` 执行，不属于 Vitest 运行时测试；具体业务端点
 * 或响应字段一旦从 AppType 退化，下面的类型约束就会让 TypeScript 编译失败。
 */
import { hc, type InferRequestType, type InferResponseType } from 'hono/client'
import type { AppType } from '@knowledge-base/api/rpc'

type Client = ReturnType<typeof hc<AppType>>
type Assert<T extends true> = T
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false

type CreateItemEndpoint = Client['api']['v1']['items']['$post']
type UpdateItemContentEndpoint = Client['api']['v1']['items'][':id']['content']['$patch']
type SetUserRolesEndpoint = Client['api']['v1']['admin']['users'][':userId']['roles']['$put']
type GetAdminUserEndpoint = Client['api']['v1']['admin']['users'][':userId']['$get']
type SoftDeleteUserEndpoint = Client['api']['v1']['admin']['users'][':userId']['soft-delete']['$post']
type RestoreUserEndpoint = Client['api']['v1']['admin']['users'][':userId']['restore']['$post']
type CurrentSessionEndpoint = Client['api']['v1']['auth']['session']['$get']
type ExplorationTrackListEndpoint = Client['api']['v1']['exploration-tracks']['$get']
type ReviewEndpoint = Client['api']['v1']['reviews'][':id']['$get']
type MethodContextEndpoint = Client['api']['v1']['method-applications'][':id']['context']['$get']
type SearchEndpoint = Client['api']['v1']['search']['$get']
type DashboardEndpoint = Client['api']['v1']['dashboard']['$get']
type BackupEndpoint = Client['api']['v1']['backup']['$get']
type TrashEndpoint = Client['api']['v1']['trash']['$get']

type CreateItemRequest = InferRequestType<CreateItemEndpoint>
type UpdateItemContentRequest = InferRequestType<UpdateItemContentEndpoint>
type SetUserRolesRequest = InferRequestType<SetUserRolesEndpoint>
type GetAdminUserResponse = InferResponseType<GetAdminUserEndpoint, 200>
type SoftDeleteUserRequest = InferRequestType<SoftDeleteUserEndpoint>
type RestoreUserResponse = InferResponseType<RestoreUserEndpoint, 200>
type CurrentSessionResponse = InferResponseType<CurrentSessionEndpoint, 200>
type CreateItemResponse = InferResponseType<CreateItemEndpoint, 201>
type ExplorationTrackListResponse = InferResponseType<ExplorationTrackListEndpoint, 200>
type ReviewResponse = InferResponseType<ReviewEndpoint, 200>
type MethodContextResponse = InferResponseType<MethodContextEndpoint, 200>
type SearchResponse = InferResponseType<SearchEndpoint, 200>
type DashboardResponse = InferResponseType<DashboardEndpoint, 200>
type BackupResponse = InferResponseType<BackupEndpoint, 200>
type TrashResponse = InferResponseType<TrashEndpoint, 200>

type _CreateTitleIsTyped = Assert<Equal<CreateItemRequest['json']['title'], string | undefined>>
type _DynamicItemIdIsTyped = Assert<Equal<UpdateItemContentRequest['param']['id'], string>>
type _AdminTargetIdIsTyped = Assert<Equal<SetUserRolesRequest['param']['userId'], string>>
type _AdminOperationIdIsTyped = Assert<Equal<SetUserRolesRequest['json']['operationId'], string>>
type _AdminDeletedAtIsTyped = Assert<Equal<GetAdminUserResponse['deletedAt'], string | null>>
type _SoftDeleteOperationIdIsTyped = Assert<Equal<SoftDeleteUserRequest['json']['operationId'], string>>
type _RestoredDeletedAtIsTyped = Assert<Equal<RestoreUserResponse['deletedAt'], string | null>>
type _SessionUserIdIsTyped = Assert<Equal<CurrentSessionResponse['user']['id'], string>>
type _CreatedItemTitleIsTyped = Assert<Equal<CreateItemResponse['title'], string>>
type _ExplorationTrackNameIsTyped = Assert<Equal<ExplorationTrackListResponse[number]['track']['name'], string>>
type _ReviewActionIsTyped = Assert<Equal<ReviewResponse['actualAction'], string>>
type _MethodContextStatusIsTyped = Assert<Equal<
  MethodContextResponse['status'],
  'no-association' | 'available' | 'method-in-trash' | 'method-purged' | 'unavailable'
>>
type _SearchResultTypeIsTyped = Assert<Equal<SearchResponse[number]['type'], 'item' | 'review' | 'method' | 'daily-note' | 'exploration-track'>>
type _DashboardMetricIsTyped = Assert<Equal<DashboardResponse['metrics']['newItems'], number>>
type _BackupVersionIsTyped = Assert<Equal<BackupResponse['version'], 1 | 2 | 3 | 4 | 5 | 6>>
type _TrashEntryTitleIsTyped = Assert<Equal<TrashResponse[number]['title'], string>>
