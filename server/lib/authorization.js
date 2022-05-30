/*  Greenly Authorization Library
    Functions included pertain to user verification and resource limitation.
*/

const persistence       = require("./persistence")
const authentication    = require("./authentication"); // One-time-usage for administrator creation

async function check(req, res, next) {
    // Identify resource type (locked routes only): User, Order, Warehouse, Distribution Center, Vehicle
    const resourceIdentification = {
        "/user/":                                       "ALL_USERS",
        "/user/:userId":                                "SINGLE_USER",
        "/user/:userId/addresses":                      "ALL_ADDRESSES",
        "/user/:userId/addresses/:addressId":           "SINGLE_ADDRESS",
        "/user/:userId/notifications":                  "ALL_NOTIFICATIONS",
        "/user/:userId/notifications/:notificationId":  "SINGLE_NOTIFICATION",
        "/user/:userId/orders":                         "ALL_USER_ORDERS",
        "/store/products/:productId":                   "SINGLE_PRODUCT",
        "/store/orders":                                "ALL_ORDERS",
        "/store/orders/:orderId":                       "SINGLE_ORDER",
        "/store/orders/:orderId/:itemId":               "SINGLE_ORDER_ITEM",
        "/store/categories":                            "ALL_CATEGORIES",
        "/store/categories/:categoryId":                "SINGLE_CATEGORY",
        "/user/:userId/cart":                           "ALL_CART_ITEMS",
        "/user/:userId/cart/:index":                    "SINGLE_CART_ITEM",
        "/user/:userId/wishlist":                       "ALL_WISHLIST_ITEMS",
        "/user/:userId/wishlist/:productId":            "SINGLE_WISHLIST_ITEM"
    }

    // Helper functions
    const isAdministrator = (user) => {return user.type == "ADMINISTRATOR"}
    const isConsumer = (user) => {return user.type == "CONSUMER"}

    const intent = req.method
    const incomingRoute = req.baseUrl + req.route.path

    // Interpreting resource from path
    switch (resourceIdentification[incomingRoute]) {
        case "ALL_USERS":

            /* Special situation in which a new administrator is being created */
            if (intent == "POST") {
                // Only administrators can create other administrators.
                // This is valid for: POST
                
                if (req.body.type == "ADMINISTRATOR") {

                    // This snippet is wrapped in a Promise so that it waits for the authentication middlware to run (otherwise it wouldn't wait for callback)
                    let authenticationPromise = await new Promise((resolve) => {
                        authentication.check(req, res, () => {
                            resolve()
                        })
                    })

                    // After authentication middle was been called and resolved successfully
                    if (isAdministrator(req.user)) {
                        // Allow a currently logged-in administrator to create a new administrator
                        return next()
                    }

                } else {
                    return next()
                }
            } 
            
            /* For any other access to ALL_USERS */
            else {
                // Only an administrator can access information regarding all users    
                if (isAdministrator(req.user)) return next();
            }
            break;

        case "SINGLE_USER":
            // Users can't change their account type, only administrators
            if ((intent == "PUT") && (req.body.hasOwnProperty('type'))) {
                if (isAdministrator(req.user)) {
                    return next();
                } else {
                    break;
                }
            }

            // Besides the user himself, only administrators and related transporters/suppliers can access and manipulate specific information
            // This is valid for: GET, PUT (except type changes), DELETE
            if ((req.params.userId == req.user.id) ||
                (isAdministrator(req.user))) {
                return next();
            }

            // TODO: Complete part regarding related transporters and suppliers (e.g. have an order in common)

            break;

        case "SINGLE_ADDRESS":
            // Valid for: PUT, DELETE
            if ((isAdministrator(req.user))) {
                return next();
            }

            // Check if the user is accessing own data, and if the address belongs to the user

            let userAddressIDs = req.user.Address.map((addressObject) => addressObject.id)            

            if ((req.params.userId == req.user.id) && (userAddressIDs.includes(Number(req.params.addressId)))) {
                return next();
            }

            break;
        case "ALL_ADDRESSES":
            // Only the user itself and administrators can create addresses
            // This is valid for: POST
            if ((req.params.userId == req.user.id) ||
                (isAdministrator(req.user))) {
                return next();
            }
            break;

        case "ALL_NOTIFICATIONS":
            // This is valid for: GET, PUT

            // Both users and administrators can access a user's notifications
            if (intent == "GET") {
                if  (req.params.userId == req.user.id || isAdministrator(req.user)) {
                    return next()
                }
            }

            // Only the user himself can dismiss all notifications
            if (intent == "PUT") {
                if (req.params.userId == req.user.id) {
                    return next()
                }
            }

            break;

        case "SINGLE_NOTIFICATION":
            // This is valid for: PUT
            
            // Only the user himself can dismiss a notification
            if (intent == "PUT") {
                if (req.params.userId == req.user.id) {
                    return next()
                }
            }

            break;

        case "ALL_USER_ORDERS":
            // Only the user himself can create new orders
            if (intent == "POST") {
                if (req.params.userId == req.user.id && isConsumer(req.user)) {
                    return next()
                }
            } 
            // Only the user himself or an administrator can see all user orders
            else if (intent == "GET") {
                if ((req.params.userId == req.user.id) ||
                    (isAdministrator(req.user))) {
                    return next();
                }
            }

            break;

        case "ALL_ORDERS":
            // This is valid for: GET
            // As long as they're authenticated, anyone can access ALL_ORDERS, they'll only get orders that pertain to themselves
            return next();

        case "SINGLE_ORDER":
            if (intent == "GET") {
                // Checking if the user has permission to see details regarding the order 

                let isRelated = await persistence.checkUserOrderRelationship(req.user, req.params.orderId)

                if (isRelated) {
                    return next()
                }
            }

            break;

        case "SINGLE_ORDER_ITEM":
            // This is valid for: GET, PUT
            // To access details regarding a single order, the user has to be related to the order

            if (intent == "PUT") {
                // Checking if the user has permission to see details regarding the order

                let isRelatedToOrder = await persistence.checkUserOrderRelationship(
                    req.user,
                    req.params.orderId)

                if (isRelatedToOrder) {
                    // Also checking if the item they're attempting to update belongs to them
                    let isRelatedToItem = await persistence.checkUserItemRelationship(
                        req.user,
                        req.params.orderId,
                        req.params.itemId)

                    if (isRelatedToItem) {
                        return next()
                    }
                }
            }

            break;

        case "ALL_CATEGORIES":
            // This is only valid for: POST
            if ((isAdministrator(req.user))) {
                return next();
            }

            break;

        case "SINGLE_CATEGORY":
            // This is valid for PUT and DELETE
            if ((isAdministrator(req.user))) {
                return next();
            }

            break;

        case "ALL_CART_ITEMS":
            // This is valid for: GET, POST, DELETE
            // Cart is only accessible to consumers
            if ((req.params.userId == req.user.id) && (isConsumer(req.user))) {
                return next()
            }

            break;

        case "SINGLE_CART_ITEM":
            // This is valid for: PUT, DELETE
            // Cart is only accessible to consumers
            if ((req.params.userId == req.user.id) && (isConsumer(req.user))) {
                return next()
            }

            break;
        case "ALL_WISHLIST_ITEMS":
            // This is valid for: GET, POST, DELETE
            // Wishlist is only accessible to consumers
            if ((req.params.userId == req.user.id) && (isConsumer(req.user))) {
                return next()
            }

            break;

        case "SINGLE_WISHLIST_ITEM":
            // This is valid for: DELETE
            // Wishlist is only accessible to consumers
            if ((req.params.userId == req.user.id) && (isConsumer(req.user))) {
                return next()
            }

            break;

        default:
            break;
    }

    return res.status(403).send({message: "Insufficient permissions for specified resource."})
}

module.exports = {check}