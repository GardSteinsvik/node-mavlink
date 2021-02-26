/*
 * mavlink-parser-v2.ts
 *
 * Copyright (c) 2019, 
 * Institute of Flight Mechanics and Control, University of Stuttgart.
 * Pascal Groß <pascal.gross@ifr.uni-stuttgart.de>
 * All rights reserved.
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 3 of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 */

import {MAVLinkParserBase} from "../mavlink-parser-base";
import {MAVLinkMessage, readInt64LE, readUInt64LE} from "../mavlink-message";

export class MAVLinkParserV2 extends MAVLinkParserBase {
    private last_seq: number = 0;

    constructor() {
        super();
    }

    protected start_marker: number = 0xFD;
    protected minimum_packet_length: number = 12;

    protected calculate_packet_length(bytes: Buffer): number {
        return bytes.readUInt8(1) + this.minimum_packet_length;
    }

    protected parseMessage(bytes: Buffer): MAVLinkMessage | undefined {
        const len = bytes.readUInt8(1);
        const incompat_flags = bytes.readUInt8(2);
        const compat_flags = bytes.readUInt8(3);
        const seq = bytes.readUInt8(4);
        const sysid = bytes.readUInt8(5);
        const compid = bytes.readUInt8(6);
        const msgid = bytes.readUIntLE(7, 3);
        if (bytes.length < len + this.minimum_packet_length)
            return undefined;
        const crc = bytes.readUInt16LE(len + this.minimum_packet_length - 2);

        let message: MAVLinkMessage;
        try {
            message = this.instantiateMessage(sysid, compid, msgid);

            let actual = message.x25CRC(bytes.slice(1, len + this.minimum_packet_length - 2));
            if (actual !== crc) {
                throw new Error(`CRC error: expected ${crc} but found ${actual}.`);
            }

            if (this.last_seq > 0 && this.last_seq + 1 !== seq) {
                throw new Error(`Packet loss detected.`);
            }

            if (bytes.length < this.minimum_packet_length + len) {
                throw new Error('Not enough bytes in buffer to parse the message.');
            }

            let payload = bytes.slice(this.minimum_packet_length - 2, len + this.minimum_packet_length - 2);

            // calculate expected payload length from message definition
            const full_payload_length = message._message_fields.reduce((sum: number, field) => sum + message.sizeof(field[1]), 0)
            if(payload.length < full_payload_length) {
                // allocate and append the truncated zero bytes
                const truncated: Buffer = payload.slice(0);
                const filler: Buffer = Buffer.alloc(full_payload_length - truncated.length);
                payload = Buffer.concat([truncated, filler]);
            }

            let start = 0;
            for (const field of message._message_fields) {
                const field_name: string = field[0];
                let field_type = field[1];
                const extension_field: boolean = field[2];

                let str = field_type.split('[');
                field_type = str[0];
                let field_length = message.sizeof(field_type);
                if (str.length === 2 && field_type == 'char') {
                    message[field_name] = this.read(payload, start, field_type);
                    let mult = parseInt(str[1].slice(0, -1));
                    start += Math.min(field_length * mult, message[field_name].length);
                } else if (str.length === 2 && field_type != 'char') {
                    let mult = parseInt(str[1].slice(0, -1));
                    message[field_name] = new Array(mult)
                    for (let i = 0;i < mult;i++) {
                        if (start < len - 3) {
                            message[field_name][i] = this.read(payload, start, field_type);
                            start += field_length;
                        } else {
                            message[field_name][i] = 0
                        }
                    }
                }
                // ignore extension_field if at the end of the payload
                else if (!(extension_field && start + field_length > payload.length)) {
                    message[field_name] = this.read(payload, start, field_type);
                    start += field_length;
                }
            }

            return message;
        } catch (e) {
            throw e;
        }
    }

    private read(bytes: Buffer, start: number, type: string): number | string | undefined {
        switch (type) {
            case "uint8_t":
                return bytes.readUInt8(start);
            case "uint16_t":
                return bytes.readUInt16LE(start);
            case "uint32_t":
                return bytes.readUInt32LE(start);
            case "uint64_t":
                return readUInt64LE(bytes, start);
            case "int8_t":
                return bytes.readInt8(start);
            case "int16_t":
                return bytes.readInt16LE(start);
            case "int32_t":
                return bytes.readInt32LE(start);
            case  "int64_t":
                return readInt64LE(bytes, start);
            case "float":
                return bytes.readFloatLE(start);
            case "double":
                return bytes.readDoubleLE(start);
            case "char":
                let nullTerminator = bytes.indexOf(0x00, start)
                if (nullTerminator == -1) {
                    return bytes.toString('ascii', start);
                } else {
                    return bytes.toString('ascii', start, nullTerminator);
                }
        }
    }
}
