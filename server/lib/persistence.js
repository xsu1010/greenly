/*  Greenly Persistence Library
    Functions included pertain to database access and manipulation.
*/

const { PrismaClient, Prisma, } = require('@prisma/client');
const {Client} = require("@googlemaps/google-maps-services-js");
const bcrypt = require('bcrypt');
const { check, boolean } = require('yargs');
const argv = require('../server').argv

// Use 10 salt rounds for each hash
const saltRounds = 10;

// Round coordinates to 6 decimal places
const roundingPrecision = 6;

// Proper rounding function as oposed to JS Math
function roundCoordinates(value, decimals) {
    return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
}

/* Persistence Init */

const prisma = new PrismaClient({
    // Log database operations if -m flag is present
    log: argv.m || argv.databaseMonitoring ? ['query', 'info', 'warn', 'error'] : []
});
const maps = new Client();

/* Checking database availability */

prisma.$connect().catch((reason) => {
    console.log("📶 Database connection failed.")
    process.exit(1)
})


/* User Functions */

/* Returns user object on creation, or null if invalid */
async function createUser(params) {
    try {
        let newUser = await prisma.user.create({
            data: {
                first_name: params.first_name,
                last_name: params.last_name,
                email: params.email,
                phone: params.phone,
                type: params.type
            }
        })

        let newCredentials = await prisma.credentials.create({
            data: {
                id: newUser.id,
                provider: "local",
                value: bcrypt.hashSync(params.password, saltRounds)
            }
        })

        const newAddress = await prisma.address.create({
            data: {
                street: params.address.street,
                country: params.address.country,
                city: params.address.city,
                // Using dummy values for testing. Use this for API call:
                // geocoded.data.results[0].geometry.location.lat
                // geocoded.data.results[0].geometry.location.lng
                latitude: geocoded.data.results[0].geometry.location.lat,
                longitude: geocoded.data.results[0].geometry.location.lng,
                postal_code: params.address.postal_code
            }
        })

        // Create a new company if the user is a transporter or a supplier
        if (["TRANSPORTER", "SUPPLIER"].includes(newUser.type)) {
            const newCompany = await prisma.company.create({
                data: {
                    name: params.company.name,
                    bio: params.company.bio,
                    email: params.company.email
                }
            })

            // Updating the user's company after we're sure user creation didn't go wrong.
            newUser = await prisma.user.update({
                where: {
                    id: newUser.id
                },
                data: {
                    company: newCompany.id
                }
            })
        }

        return {id: newUser.id};

    } catch (e) {
        console.log(e)
        return null;
    }
}

async function updateUser(id, params) {

    /* Updating only referenced parameters into database
       The point of this procedure is to understand which properties
       the user is attempting to change, and to change only those.
       The JSON payload format differs slightly from what Prisma.UserSelection accepts, so the differences have to be mapped
       using userKeyMap and addressKeyMap
    */

    const userKeyMap = {
        first_name: "first_name",
        last_name: "last_name",
        email: "email",
        phone: "phone",
        type: "type",
        new_password: "password"
    }

    const companyKeyMap = {
        name: "name",
        bio: "bio",
        email: "email"
    }

    const userDataSelection = {}


    // Mapping user data

    for (const [key, value] of Object.entries(params)) {
        if (key in userKeyMap) {
            if (key == "new_password") {
                userDataSelection[userKeyMap[key]] = bcrypt.hashSync(value, saltRounds)

            } else {
                userDataSelection[userKeyMap[key]] = value
            }
        }
    }

    // If the user is a transporter/supplier, allow them to edit company info

    if (params.hasOwnProperty("company")) {
        companyDataSelection = {}
        for (const [key, value] of Object.entries(params.company)) {
            if (key in companyKeyMap) {
                companyDataSelection[companyKeyMap[key]] = value
            }
        }
        userDataSelection.Company = {update: companyDataSelection}
    }

    try {
        const updatedUser = await prisma.user.update({
            where: {
                id: id
            },
            data: userDataSelection
        })

        return updatedUser;

    } catch (e) {
        console.log(e)
        return null;
    }

}

/* Returns true if deleted succesfully, false otherwise */
async function deleteUser(id) {
    try {
        /* TODO: Eventually also delete: 
                * All orders by user, in case of consumer
                * Company
                * All supplies being supplied by supplier
                * All transports by transporter
        */

        if (getUserByID(id)) {
            // Delete user and all his addresses
            const deletedUser = await prisma.user.delete({
                where: {
                    id: id
                },
                include: {
                    Address: true
                }
            })

            await prisma.address.deleteMany({
                where: {
                    user: id
                }
            })


            return true
        } else {
            return false
        }

    } catch (e) {
        console.log(e)
        return false;
    }

}

async function getAllUsers() {
    return users = await prisma.user.findMany({
        select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            phone: true,
            type: true,
        }
    });
}

async function getUserByID(id, withPassword=false) {
    try {
        return user = await prisma.user.findUnique({
            where: {
                id: id
            },
            select: {
                id: true,
                first_name: true,
                last_name: true,
                email: true,
                phone: true,
                type: true,
                Credentials: withPassword ? {
                    select: {
                        provider: true,
                        value: true,
                    }
                } : withPassword,
                Address: {
                    select: {
                        id: true,
                        street: true,
                        city: true,
                        country: true,
                        postal_code: true,
                        nif: true,
                        latitude: true,
                        longitude: true,
                        is_shipping: true,
                        is_billing: true,
                    }
                },
                Company: {
                    select: {
                        id: true,
                        name: true,
                        bio: true,
                    }
                },
            }
        })
    } catch (e){
        console.log(e)
        return null;
    }
}

async function getUserByEmail(email, withPassword=false) {
    // TODO: Fix 'with password'
    try {
        return user = await prisma.user.findUnique({
            where: {
                email: email
            },
            select: {
                id: true,
                first_name: true,
                last_name: true,
                email: true,
                phone: true,
                Credentials: withPassword ? {
                    select: {
                        provider: true,
                        value: true
                    }
                } : withPassword,
                type: true,
                Address: {
                    select: {
                        id: true,
                        street: true,
                        city: true,
                        country: true,
                        postal_code: true,
                        nif: true,
                        latitude: true,
                        longitude: true,
                        is_shipping: true,
                        is_billing: true,
                    }
                },
                Company: {
                    select: {
                        id: true,
                        name: true,
                        bio: true,
                    }
                },
            }
        })
    } catch (e){
        console.log(e)
        return null;
    }
}

async function checkUserConflict(attribute, value) {
    // Checks if a user attribute is already in use.
    // Should be used for email and phone
    // Returns boolean representing the existance of conflict.

    let result;

    try{
        if (attribute == "id") {
            result = await prisma.user.findUnique({
                'where': {
                    id: value
                }
            })
        } else if (attribute == "email") {
            result = await prisma.user.findUnique({
                'where': {
                    email: value
                }
            })
        }
    
        return result;
    } catch (e) {
        return null;
    }
}

/* Address Functions */

async function createAddress(userID,
                             street,
                             city,
                             country,
                             postal_code,
                             nif) {

    // Obtaining data from Google Geocoding API

    try {
        const geocoded = await maps.geocode({
            params: {
                address: `${street}, ${city}, ${country}`,
                key: process.env.GOOGLE_API_KEY
            }
        })

        lat = roundCoordinates(geocoded.data.results[0].geometry.location.lat, roundingPrecision);
        lng = roundCoordinates(geocoded.data.results[0].geometry.location.lng, roundingPrecision);
    } catch (e) {
        lat = 0;
        lng = 0;
    }

    try {
        let newAddress = await prisma.address.create({
            data: {
                user: userID,
                nif: nif,
                street: street,
                city: city,
                country: country,
                postal_code: postal_code,
                latitude: lat,
                longitude: lng
            }
        })

        return {id: newAddress.id}
    } catch (e) {
        console.log(e)
        return null;
    }
}

async function updateAddress(userId, addressId, params) {
    const addressKeyMap = {
        street: "street",
        city: "city",
        postal_code: "postal_code",
        country: "country",
        nif: "nif",
        is_shipping: "is_shipping",
        is_billing: "is_billing"
    }

    const addressDataSelection = {}

    // Map only selected address data

    for (const [key, value] of Object.entries(params)) {
        if (key in addressKeyMap) {
            addressDataSelection[addressKeyMap[key]] = value
        }
    }

    try {

        // Set all other user addresses to false if new address is  default billing or shipping

        if (addressDataSelection["is_shipping"]) {
            await prisma.address.updateMany({
                where: {
                    user: userId
                },
                data: {
                    is_shipping: false
                }
            })
        }
        if (addressDataSelection["is_billing"]) {
            await prisma.address.updateMany({
                where: {
                    user: userId
                },
                data: {
                    is_billing: false
                }
            })
        }

        let updatedAddress = await prisma.address.update({
            where: {
                id: addressId
            },
            data: addressDataSelection
        })

        // Now that all the information is up to date, we can re-calculate lat and lng, and reinsert

        let lat = 0;
        let lng = 0;

        try {
            const geocoded = await maps.geocode({
                params: {
                    address: `${updatedAddress.street}, ${updatedAddress.city}, ${updatedAddress.country}`,
                    key: process.env.GOOGLE_API_KEY
                }
            })
            lat = roundCoordinates(geocoded.data.results[0].geometry.location.lat, roundingPrecision);
            lng = roundCoordinates(geocoded.data.results[0].geometry.location.lng, roundingPrecision);

        } catch (e) {
            console.log(e)
        }

        updatedAddress = await prisma.address.update({
            where: {
                id: addressId
            },
            data: {
                latitude: lat,
                longitude: lng
            }
        })


        return updateAddress;
    } catch (e) {
        console.log(e)
        return null;
    }
}

async function deleteAddress(id) {
    try {
        await prisma.address.delete({
            where: {
                id: id
            }
        })

        return true;

    } catch (e) {
        // If it doesn't exist, prisma throws "RecordNotFound"
        console.log(e)
        return false
    }
}

/* Product Functions */

/**
 *
 * @param {Number} limit
 * @param {Number} page
 * @param {String} category
 * @param {String[]} keywords
 * @returns An object composed of the total number of pages for the included filters and an array of product objects.
 */
async function getAllProducts(limit = 50,
                              page = 1, 
                              category, 
                              keywords,
                              sort,
                              price_range) {

    // Helper functions
    const manualPagination = (array, page_size, page_number) => {
        return array.slice((page_number - 1) * page_size, page_number * page_size);
    }

    const calcLowestPrice = (supplies) => {
        let min = Number.POSITIVE_INFINITY;
        supplies.forEach((supply) => {
            if (parseFloat(supply.price) < parseFloat(min)) {
                min = supply.price
            }
        })

        return min;
    };

    const calcHighestPrice = (supplies) => {
        let max = Number.NEGATIVE_INFINITY;
        supplies.forEach((supply) => {
            if (parseFloat(supply.price) > parseFloat(max)) {
                max = supply.price
            }
        })

        return max;
    };

    let filterSelection = {}

    let sortingMethod = {}

    /* Sorting */

    // If no sorting method was specified
    if (!sort) {
        sort = "newest"
    }

    switch (sort) {
        case "newest":
            sortingMethod.id = "desc"
            break;
        case "oldest":
            sortingMethod.id = "asc"
            break;
        case "name_asc":
            sortingMethod.name = "asc"
            break;
        case "name_desc":
            sortingMethod.name = "desc"
            break;
    }

    if (category) {
        // Initialize OR search between name, description and exact search for categories
        filterSelection.AND = []

        // Prisma doesn't support nested queries, this query is required to find all sub-categories of the mentioned category
        let subCategories = await prisma.$queryRaw`WITH RECURSIVE CTE (id, name, parent_id) AS (SELECT id, name, parent_category FROM Category WHERE parent_category = ${category} UNION ALL SELECT p.id, p.name, p.parent_category FROM Category p INNER JOIN CTE ON p.parent_category = CTE.id) SELECT * FROM CTE;`

        // Adding all subcategory IDs to search
        // This piece of code produces objects such as {OR:[category:x, category:y, ...]}, which allow us to obtain every product belonging to the requested
        // category and its subcategories
        filterSelection.AND.push({OR:[{category:category}, ...subCategories.map((subCategory) => ({category: subCategory.id}))]})
    }

    if (keywords) {
        // The following code searches the keywords on both name and description of the products

        // Initialize OR for exact search of parent and child categories
        filterSelection.OR = []

        // Initializing filter objects
        nameKeywords = {"name":{}}
        descriptionKeywords = {"description":{}}

        // According to Prisma Full-Search API and MySQL Full-Text Search
        if (Array.isArray(keywords)) {
            nameKeywords.name.search = descriptionKeywords.description.search = keywords.join("* ")
        } else {
            nameKeywords.name.search = descriptionKeywords.description.search = keywords + "*"
        }
        
        // Adding created filters to the filterSelection
        filterSelection.OR.push(nameKeywords, descriptionKeywords)
    }

    let products;

    if (["price_asc", "price_desc"].includes(sort)) {

        // Special price sorting against Prisma limitations
        // A Zeval banger -> day 1238987 of wishing JS had list comprehension.
        /* What follows is comparable to magic.
           Please do not ever ask what this does or how it was created.
           Ingredients include:
           * Cocaine
           * Adderall
           * Alcohol
           * Cocaine again
        */

        let sortedProductIDs;

        if (sort == "price_asc") {
            // Sort by absolute minimum
            sortedProductIDs = await prisma.supply.groupBy({
                by: ['product'],
                orderBy: {
                  _min: {
                    price: 'asc'
                  }
                }
              })
        } else if (sort == "price_desc") {
            // Sort by absolute maximum
            sortedProductIDs = await prisma.supply.groupBy({
                by: ['product'],
                orderBy: {
                  _max: {
                    price: 'desc'
                  }
                }
              })
        }

        products = await Promise.all(
            sortedProductIDs.map((currentProduct) => prisma.product.findMany({
                where: {id:currentProduct.product, ...filterSelection},

                select: {
                    id: true,
                    name: true,
                    description: true,
                    complement_name: true,
                    complement_amount: true,
                    Category: {
                        select: {
                            id: true,
                            name: true
                        }
                    },
                    Supply: {
                        select: {
                            price: true
                        }
                    }
                } }))
            )

        // Unpack from findMany nested structure
        products = products.map((product) => product[0])

        // Remove bad results
        products = products.filter((product) => product != undefined)

    } else {
        // Get products based on provided filters
        products = await prisma.product.findMany({
            select: {
                id: true,
                name: true,
                description: true,
                complement_name: true,
                complement_amount: true,
                Category: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                Supply: {
                    select: {
                        price: true
                    }
                }
            },
            where: filterSelection,
            orderBy: sortingMethod
        });
    }

    // Calculating and defining lowest and highest prices for each product
    products.forEach((product) => {
        if (product.Supply.length > 0) {
            product.lowest_price = parseFloat(calcLowestPrice(product.Supply).toFixed(2))
            product.highest_price = parseFloat(calcHighestPrice(product.Supply).toFixed(2))
        }
    })

    // Checking if price bounds have been set
    const minPrice = price_range.min || 0;
    const maxPrice = price_range.max || Number.POSITIVE_INFINITY;

    // Filtering products based on price
    products = products.filter((product) =>
        product.lowest_price > Number(minPrice) &&
        product.lowest_price < Number(maxPrice))

    // Get total product count
    let totalProducts = products.length

    // Manual Pagination
    products = manualPagination(products, limit, page)

    return {total_products: totalProducts, products}
}

async function getProductByID(id){
    try {
        let result =  product = await prisma.product.findUnique({
            where: {
                id: id
            },
            select: {
                id: true,
                name: true,
                description: true,
                Category: {
                    select: {
                        id: true,
                        name: true
                    }
                } ,
                complement_name: true,
                complement_amount: true,
                ProductAttribute: {
                    select: {
                        id: true,
                        title: true,
                        content: true
                    }
                },
                Supply: {
                    select: {
                        User: {
                            select: {
                                Company: {
                                    select: {
                                        name: true
                                    }
                                },
                                id: true,
                                first_name: true,
                                last_name: true,
                            }
                        },
                        warehouse: true,
                        quantity: true,
                        price: true,
                        production_date: true,
                        expiration_date: true,
                        Supply_Transporter: {
                            select: {
                                User: { // Display company name if available
                                    select: {
                                        Company: {
                                            select: {
                                                name: true
                                            }
                                        },
                                        id: true,
                                        first_name: true,
                                        last_name: true,

                                    }
                                },
                                price: true,
                            }
                        },
                        Supply_History: {
                            select: {
                                moment: true,
                                quantity: true,
                                price: true
                            }
                        }
                    }
                }
                },
        })

        if (result) {
            for (let i = 0; i < result.Supply.length; i++) {
                // Gathering further warehouse info
                let warehouse = await prisma.warehouse.findUnique({
                    where: {
                        id_supplier: {id: result.Supply[i].warehouse, supplier: result.Supply[i].User.id},
                    },
                    select: {
                        id: true,
                        resource_usage: true,
                        renewable_resources: true
                    }
                })

                result.Supply[i].warehouse = warehouse

                // Gathering futher transport info
                for (let j = 0; j < result.Supply[i].Supply_Transporter.length; j++) {
                    // Gather average emissions based on all transporter vehicles
                    let vehicle_averages = await prisma.vehicle.aggregate({
                        where: {
                            transporter: result.Supply[i].Supply_Transporter[j].User.id
                        },
                        _avg: {
                            average_emissions: true,
                            resource_usage: true
                          },
                    })

                    // Adding vehicle averages to payload
                    result.Supply[i].Supply_Transporter[j].average_emissions = vehicle_averages._avg.average_emissions;
                    result.Supply[i].Supply_Transporter[j].average_resource_usage = vehicle_averages._avg.resource_usage;
                }
            }
        }


        return result;

    } catch (e){
        console.log(e)
        return null;
    }
}

/* Category Functions */

async function getAllCategories() {
    try {
        let categories = await prisma.category.findMany({orderBy: {name: 'asc'}})


        for (category of categories) {

            // Finding subcategories of current category
            let subCategories = await prisma.$queryRaw`WITH RECURSIVE CTE (id, name, parent_id) AS (SELECT id, name, parent_category FROM Category WHERE parent_category = ${category.id} UNION ALL SELECT p.id, p.name, p.parent_category FROM Category p INNER JOIN CTE ON p.parent_category = CTE.id) SELECT * FROM CTE;`

            // Counting products in each category
            let categorySelection = {OR:[{category:category.id}, ...subCategories.map((subCategory) => ({category: subCategory.id}))]}

            category.total_products = await prisma.product.count({
                    where: categorySelection
                    })
            }

        return categories

    } catch (e) {
        console.log(e)
        return null;
    }
}

async function createCategory(name, parent_category) {
    try {

        let newCategory = await prisma.category.create({
            data: {
                name: name,
                parent_category: parent_category
            }
        })

        return newCategory.id;
    } catch (e) {
        return null;
    }
}

async function updateCategory(id, params) {
    let categoryKeyMap = {
        "name": "name",
        "parent_category": "parent_category"
    }

    let categoryDataSelection = {}

    for (const [key, value] of Object.entries(params)) {
        if (key in categoryKeyMap) {
            categoryDataSelection[categoryKeyMap[key]] = value
        }
    }

    try {
        const updatedCategory = await prisma.category.update({
            where: {
                id: id
            },
            data: categoryDataSelection
        })

        return updatedCategory
    } catch (e) {
        return null;
    }

}

async function deleteCategory(id) {
    try {
        await prisma.category.delete({
            where: {
                id: id
            }
        })

        return true;
    } catch (e) {
        if (e.code == "P2003") {
            return 409;
        }
        return false;
    }
}

/* All functions to be made available to the rest of the project should be listed here */

module.exports = {
    // User Functions
    createUser,
    updateUser,
    deleteUser,
    getUserByID,
    getUserByEmail,
    getAllUsers,
    checkUserConflict,

    // Address functions
    createAddress,
    updateAddress,
    deleteAddress,

    // Product Functions
    getAllProducts,
    getProductByID,

    // Category Functions
    getAllCategories,
    createCategory,
    updateCategory,
    deleteCategory
}