/**
 * @file can_handler.h
 * @brief CAN Frame Parser, Validator, and Telemetry State Updater
 */

#ifndef SAFEDASH_CAN_HANDLER_H
#define SAFEDASH_CAN_HANDLER_H

#include "can_frames.h"
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Initialize the CAN handler state. Must be called once at startup. */
void can_handler_init(void);

/**
 * @brief Parse incoming JSON frame bundle and update telemetry state.
 *
 * @param json_buf   Raw JSON buffer received from the CAN simulator.
 * @param len        Length of the buffer.
 * @param tel        Telemetry state to update (caller must hold the mutex).
 */
void can_handle_json_frames(const char *json_buf, size_t len,
                            safedash_telemetry_t *tel);

/**
 * @brief Inject a simulated fault into the CAN processing pipeline.
 *
 * @param fault    Fault type to activate.
 * @param param    Optional parameter (e.g., CAN ID to silence).
 */
void can_handler_set_fault(safedash_fault_type_t fault, uint8_t param);

/** Clear all active fault injections. */
void can_handler_clear_faults(void);

#ifdef __cplusplus
}
#endif

#endif /* SAFEDASH_CAN_HANDLER_H */
