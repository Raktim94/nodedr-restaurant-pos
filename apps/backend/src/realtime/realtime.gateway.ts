import { Injectable } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

// One gateway, room-per-branch — KDS/table-status/order-tracking all join
// the branch room they care about and get pushed events by name
// ("kot.updated", "table.updated", "order.updated"). Kept as a single
// injectable service (not split per concern) until there's a real reason
// to scale gateways independently.
@Injectable()
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  async handleConnection(client: Socket) {
    const branchId = client.handshake.query.branchId;
    if (typeof branchId === 'string') {
      await client.join(this.branchRoom(branchId));
    }
  }

  handleDisconnect() {
    // socket.io removes room membership automatically on disconnect
  }

  emitToBranch(branchId: string, event: string, payload: unknown) {
    this.server.to(this.branchRoom(branchId)).emit(event, payload);
  }

  private branchRoom(branchId: string) {
    return `branch:${branchId}`;
  }
}
